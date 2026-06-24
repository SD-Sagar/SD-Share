import { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { addFiles, updateTransferProgress, updateTransferStatus, removeFile } from '../redux/slices/transferSlice';
import { addLog } from '../redux/slices/roomSlice';
import webrtcService from '../services/webRTC';
import { storageService } from '../services/storage';
import { generateFileId, mergeChunks, downloadBlob, CHUNK_SIZE } from '../services/chunking';
import { store } from '../redux/store'; 

export const useFileTransfer = () => {
  const dispatch = useDispatch();
  const { isCreator } = useSelector((state) => state.room);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const selectedFilesRef = useRef([]);
  
  const currentTransferFileIdRef = useRef(null);
  const currentReceiverBufferRef = useRef([]);
  const currentReceiverBytesRef = useRef(0);
  const currentReceiverBatchIndexRef = useRef(0);
  const currentReceiverChunkCountRef = useRef(0);
  const abortControllerRef = useRef(null);
  const savePromisesRef = useRef([]);
  const isTransferringRef = useRef(false);

  useEffect(() => {
    webrtcService.onChannelMessage = async (data) => {
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.type === 'FILE_METADATA') {
          dispatch(addFiles([{ ...msg.file, id: msg.file.fileId, isMine: false }]));
          dispatch(updateTransferStatus({ fileId: msg.file.fileId, status: 'idle' }));
          dispatch(addLog({ message: `Received metadata for ${msg.file.name}` }));
        } else if (msg.type === 'CHUNK_REQUEST') {
          handleBlastFile(msg.fileId);
        } else if (msg.type === 'TRANSFER_COMPLETE') {
          await flushReceiverBuffer(); // flush remaining
          await Promise.all(savePromisesRef.current);
          savePromisesRef.current = [];
          
          dispatch(updateTransferStatus({ fileId: msg.fileId, status: 'completed' }));
          dispatch(addLog({ message: `Transfer complete!`, type: 'success' }));
          
          const fileMeta = store.getState().transfer.files.find(f => f.id === msg.fileId);
          if (fileMeta) {
            try {
              dispatch(addLog({ message: `Merging file...` }));
              const blob = await mergeChunks(msg.fileId, fileMeta.totalChunks, storageService);
              downloadBlob(blob, fileMeta.name);
              dispatch(addLog({ message: `File downloaded!`, type: 'success' }));
              await storageService.clearFileChunks(msg.fileId, fileMeta.totalChunks);
            } catch (error) {
              dispatch(addLog({ message: `Error merging file: ${error.message}`, type: 'error' }));
            }
          }
          currentTransferFileIdRef.current = null;
        } else if (msg.type === 'TRANSFER_CANCELED') {
           dispatch(updateTransferStatus({ fileId: msg.fileId, status: 'canceled' }));
           dispatch(addLog({ message: `Transfer canceled by peer.`, type: 'error' }));
           if (abortControllerRef.current) {
             abortControllerRef.current.abort();
           }
           currentTransferFileIdRef.current = null;
           isTransferringRef.current = false;
        }
      } else if (data instanceof ArrayBuffer) {
        await handleReceiveRawChunk(data);
      }
    };
  }, [dispatch]);

  const handleReceiveRawChunk = async (arrayBuffer) => {
    const fileId = currentTransferFileIdRef.current;
    if (!fileId) return;

    currentReceiverBufferRef.current.push(arrayBuffer);
    currentReceiverBytesRef.current += arrayBuffer.byteLength;

    const fileMeta = store.getState().transfer.files.find(f => f.id === fileId);
    const totalChunks = fileMeta ? fileMeta.totalChunks : 1;
    
    currentReceiverChunkCountRef.current++;
    const currentChunkIndex = currentReceiverChunkCountRef.current;

    if (currentChunkIndex % 100 === 0 || currentChunkIndex === totalChunks) {
      dispatch(updateTransferProgress({ 
        fileId, 
        progress: Math.round((currentChunkIndex / totalChunks) * 100),
        receivedChunks: currentChunkIndex
      }));
    }

    if (currentReceiverBytesRef.current >= 5 * 1024 * 1024 || currentChunkIndex === totalChunks) {
      flushReceiverBuffer();
    }
  };

  const flushReceiverBuffer = async () => {
    const fileId = currentTransferFileIdRef.current;
    if (!fileId || currentReceiverBufferRef.current.length === 0) return;
    
    const buffersToSave = [...currentReceiverBufferRef.current];
    const batchIndex = currentReceiverBatchIndexRef.current++;
    
    currentReceiverBufferRef.current = [];
    currentReceiverBytesRef.current = 0;

    const combinedBlob = new Blob(buffersToSave);
    const savePromise = storageService.saveChunk(fileId, `batch_${batchIndex}`, combinedBlob);
    savePromisesRef.current.push(savePromise);
    await savePromise;
  };

  const handleFileSelect = (files) => {
    const fileArray = Array.from(files);
    
    // Wrap File objects with a unique ID so we can support selecting the same file multiple times
    const newFilesWithIds = fileArray.map(f => ({
      id: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).substring(2, 9)}`.replace(/[^a-zA-Z0-9-]/g, ''),
      file: f
    }));

    const allFiles = [...selectedFilesRef.current, ...newFilesWithIds];
    setSelectedFiles(allFiles);
    selectedFilesRef.current = allFiles;
    
    const metadataList = newFilesWithIds.map(item => ({
      id: item.id,
      name: item.file.name,
      size: item.file.size,
      type: item.file.type,
      totalChunks: Math.ceil(item.file.size / CHUNK_SIZE),
      isMine: true
    }));
    
    dispatch(addFiles(metadataList));
  };

  const startTransfer = async (specificFileId = null) => {
    const filesToAnnounce = specificFileId 
      ? selectedFilesRef.current.filter(f => f.id === specificFileId)
      : selectedFilesRef.current; // Depending on requirements, we announce all selected files

    for (const item of filesToAnnounce) {
      const fileId = item.id;
      const file = item.file;
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      
      const metadata = {
        type: 'FILE_METADATA',
        file: {
          fileId,
          name: file.name,
          size: file.size,
          fileType: file.type,
          totalChunks
        }
      };
      
      dispatch(addLog({ message: `Announcing file ${file.name}` }));
      webrtcService.sendData(JSON.stringify(metadata));
      
      // Update state so the UI knows this file is waiting for the peer to download
      dispatch(updateTransferStatus({ fileId, status: 'waiting' }));
    }
  };

  const requestDownload = (fileId) => {
    currentTransferFileIdRef.current = fileId;
    currentReceiverBufferRef.current = [];
    currentReceiverBytesRef.current = 0;
    currentReceiverChunkCountRef.current = 0;
    currentReceiverBatchIndexRef.current = 0;
    
    dispatch(updateTransferStatus({ fileId, status: 'transferring' }));
    webrtcService.sendData(JSON.stringify({
      type: 'CHUNK_REQUEST',
      fileId,
      chunkIndex: 0
    }));
  };

  const handleBlastFile = async (fileId) => {
    if (isTransferringRef.current) {
      dispatch(addLog({ message: `Already transferring a file.`, type: 'error' }));
      return;
    }
    isTransferringRef.current = true;
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const item = selectedFilesRef.current.find(f => f.id === fileId);
    if (!item) {
      isTransferringRef.current = false;
      return;
    }
    const file = item.file;

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let offset = 0;
    let chunkIndex = 0;

    dispatch(updateTransferStatus({ fileId, status: 'transferring' }));
    dispatch(addLog({ message: `Sending file chunks...` }));

    while (offset < file.size) {
      if (signal.aborted) {
        break;
      }
      
      const chunkBlob = file.slice(offset, offset + CHUNK_SIZE);
      const arrayBuffer = await chunkBlob.arrayBuffer();
      
      await webrtcService.waitForBuffer();
      if (signal.aborted) break;

      webrtcService.sendData(arrayBuffer);
      
      offset += CHUNK_SIZE;
      chunkIndex++;

      if (chunkIndex % 100 === 0 || chunkIndex === totalChunks) {
        dispatch(updateTransferProgress({ 
          fileId, 
          progress: Math.round((chunkIndex / totalChunks) * 100),
          receivedChunks: chunkIndex
        }));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    isTransferringRef.current = false;

    if (!signal.aborted) {
      webrtcService.sendData(JSON.stringify({ type: 'TRANSFER_COMPLETE', fileId }));
      dispatch(updateTransferStatus({ fileId, status: 'completed' }));
    }
  };

  const cancelTransfer = (fileId) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    webrtcService.sendData(JSON.stringify({ type: 'TRANSFER_CANCELED', fileId }));
    dispatch(updateTransferStatus({ fileId, status: 'canceled' }));
    storageService.clearFileChunks(fileId); // Clean up disk
    currentTransferFileIdRef.current = null;
    isTransferringRef.current = false;
    savePromisesRef.current = [];
  };
  
  const removeFromQueue = (fileId) => {
    cancelTransfer(fileId);
    selectedFilesRef.current = selectedFilesRef.current.filter(f => f.id !== fileId);
    setSelectedFiles(selectedFilesRef.current);
    dispatch(removeFile(fileId));
  };

  const handlePeerDisconnect = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const fileId = currentTransferFileIdRef.current;
    if (fileId) {
      dispatch(updateTransferStatus({ fileId, status: 'disconnected' }));
      dispatch(addLog({ message: `Peer disconnected. Transfer paused.`, type: 'error' }));
      currentTransferFileIdRef.current = null;
      isTransferringRef.current = false;
    }
  };

  return { 
    selectedFiles, 
    handleFileSelect, 
    startTransfer, 
    requestDownload, 
    cancelTransfer, 
    removeFromQueue,
    handlePeerDisconnect
  };
};
