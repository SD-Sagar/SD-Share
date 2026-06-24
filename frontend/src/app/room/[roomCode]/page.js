'use client';

import { useEffect, useState, use } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Copy, UploadCloud, Play, Pause, CheckCircle2, AlertCircle, Loader2, ArrowLeft, Trash2, XCircle } from 'lucide-react';
import { setRoomInfo, setStatus, setPeerId, resetRoom } from '@/redux/slices/roomSlice';
import { resetTransfers } from '@/redux/slices/transferSlice';
import webrtcService from '@/services/webRTC';
import { useFileTransfer } from '@/hooks/useFileTransfer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function RoomPage(props) {
  const params = use(props.params);
  const searchParams = use(props.searchParams);

  const router = useRouter();
  const dispatch = useDispatch();
  const roomCode = params.roomCode;
  
  // To avoid Next.js build errors with searchParams missing in props type in some versions,
  // we can use a basic state or read it from URL. But passing it via props works in Next 14+ App router.
  const mode = searchParams?.mode;
  
  const { status, isCreator, logs } = useSelector((state) => state.room);
  const { files, transfers } = useSelector((state) => state.transfer);
  const { selectedFiles, handleFileSelect, startTransfer, requestDownload, cancelTransfer, removeFromQueue, handlePeerDisconnect } = useFileTransfer();

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!roomCode) return;
    
    // Connect to Socket.IO and Join Room
    webrtcService.connectSocket(process.env.NEXT_PUBLIC_SOCKET_URL);
    dispatch(setRoomInfo({ roomId: roomCode, isCreator: mode === 'sender' }));
    
    if (mode === 'sender') {
      webrtcService.joinRoom(roomCode, mode);
    } else {
      webrtcService.joinRoom(roomCode, mode);
    }

    // Save to local storage only for creators
    if (mode === 'sender') {
      const saved = localStorage.getItem('sd_recent_rooms');
      let rooms = saved ? JSON.parse(saved) : [];
      if (!rooms.find(r => r.code === roomCode)) {
        rooms.push({ code: roomCode, mode, timestamp: Date.now() });
        localStorage.setItem('sd_recent_rooms', JSON.stringify(rooms));
      }
    }

    webrtcService.onPeerJoin = (peerId) => {
      dispatch(setStatus('connected'));
      dispatch(setPeerId(peerId));
    };

    webrtcService.onPeerLeave = () => {
      dispatch(setStatus('disconnected'));
      dispatch(setPeerId(null));
      handlePeerDisconnect();
    };

    webrtcService.onChannelOpen = () => {
      dispatch(setStatus('ready'));
    };

    webrtcService.socket.on('room-deleted', () => {
      alert('The creator has deleted this room.');
      router.push('/');
    });

    return () => {
      webrtcService.socket?.emit('leave-room', roomCode);
      webrtcService.resetConnection();
      dispatch(resetRoom());
      dispatch(resetTransfers());
    };
  }, [roomCode, mode, dispatch]);

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen p-4 md:p-8">
      {/* Header */}
      <header className="flex items-center justify-between mb-8 max-w-6xl mx-auto">
        <Button variant="ghost" onClick={() => router.push('/')} className="px-2">
          <ArrowLeft className="w-5 h-5 mr-2" />
          Leave Room
        </Button>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 bg-zinc-900/50 px-4 py-2 rounded-lg border border-zinc-800">
            <span className="text-sm text-zinc-400">Room Code:</span>
            <span className="font-mono text-lg font-bold text-indigo-400 tracking-wider">{roomCode}</span>
            <Button variant="ghost" size="icon" onClick={copyRoomCode} className="h-8 w-8 ml-2">
              {copied ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${status === 'ready' ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
            <span className="text-sm text-zinc-400 hidden sm:inline">
              {status === 'ready' ? 'Peer Connected' : 'Waiting for Peer...'}
            </span>
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
        
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          
          <Card className="border-dashed border-2 border-zinc-800 hover:border-indigo-500/50 transition-colors">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <UploadCloud className="w-12 h-12 text-zinc-500 mb-4" />
              <h3 className="text-xl font-semibold mb-2">Select Files to Share</h3>
              <p className="text-zinc-400 text-sm mb-6 text-center max-w-sm">
                Drag and drop files here, or click to select files. Files are transferred directly to the receiver.
              </p>
              <input
                type="file"
                multiple
                className="hidden"
                id="file-upload"
                onChange={(e) => handleFileSelect(e.target.files)}
              />
              <Button onClick={() => document.getElementById('file-upload').click()}>
                Browse Files
              </Button>
            </CardContent>
          </Card>

          {/* File List */}
          <Card>
            <CardHeader>
              <CardTitle>Transfer Queue</CardTitle>
              <CardDescription>Files available for transfer</CardDescription>
            </CardHeader>
            <CardContent>
              {files.length === 0 ? (
                <div className="text-center text-zinc-500 py-8">No files selected</div>
              ) : (
                <div className="space-y-4">
                  {files.map((file) => (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={file.id} 
                      className="bg-zinc-900/50 p-4 rounded-lg border border-zinc-800"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-medium truncate max-w-[200px] sm:max-w-xs">
                            {file.name}
                            {file.isMine && <span className="ml-2 text-[10px] uppercase bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full">Sent by you</span>}
                          </p>
                          <p className="text-xs text-zinc-400">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          {/* Sender Buttons */}
                          {file.isMine && status === 'ready' && !transfers[file.id] && (
                            <Button size="sm" onClick={() => startTransfer(file.id)}>Announce</Button>
                          )}
                          {file.isMine && status === 'ready' && transfers[file.id] && ['waiting', 'disconnected', 'canceled'].includes(transfers[file.id]?.status) && (
                            <Button size="sm" onClick={() => startTransfer(file.id)}>Resend</Button>
                          )}
                          
                          {/* Receiver Buttons */}
                          {!file.isMine && (!transfers[file.id] || ['waiting', 'disconnected', 'canceled'].includes(transfers[file.id]?.status)) && (
                            <Button size="sm" onClick={() => requestDownload(file.id)}>Download</Button>
                          )}
                          
                          {transfers[file.id]?.status === 'transferring' && (
                            <Button size="sm" variant="destructive" onClick={() => cancelTransfer(file.id)}>
                              <XCircle className="w-4 h-4 mr-1" /> Cancel
                            </Button>
                          )}
                          
                          {transfers[file.id]?.status !== 'transferring' && (
                            <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-400/10" onClick={() => removeFromQueue(file.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                      
                      {/* Progress Bar */}
                      {transfers[file.id]?.status !== 'waiting' && (
                        <div className="mt-4">
                          <div className="flex justify-between text-xs text-zinc-400 mb-1">
                            <span>{transfers[file.id]?.progress || 0}%</span>
                            <span>{transfers[file.id]?.speed || 0} MB/s</span>
                          </div>
                          <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                            <motion.div 
                              className="bg-indigo-500 h-full rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${transfers[file.id]?.progress || 0}%` }}
                              transition={{ duration: 0.3 }}
                            />
                          </div>
                          <p className="text-xs text-zinc-500 mt-2">
                            Chunks: {transfers[file.id]?.receivedChunks || 0} / {file.totalChunks}
                          </p>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Activity Feed Sidebar */}
        <div className="lg:col-span-1">
          <Card className="h-full max-h-[600px] flex flex-col">
            <CardHeader>
              <CardTitle className="text-lg">Activity Feed</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-4">
              {logs.length === 0 ? (
                <div className="text-center text-zinc-500 py-4 text-sm">No activity yet</div>
              ) : (
                logs.map((log) => (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={log.id} 
                    className="flex flex-col border-l-2 pl-3 py-1 text-sm border-indigo-500/50"
                  >
                    <span className="text-xs text-zinc-500 mb-1">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-400' : 'text-zinc-300'}`}>
                      {log.message}
                    </span>
                  </motion.div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

      </main>
    </div>
  );
}
