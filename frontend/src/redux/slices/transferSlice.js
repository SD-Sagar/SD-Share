import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  files: [], // Array of file metadata objects
  transfers: {}, // Keyed by fileId: { progress, speed, status, eta, receivedChunks }
};

const transferSlice = createSlice({
  name: 'transfer',
  initialState,
  reducers: {
    addFiles: (state, action) => {
      // action.payload: array of file metadata
      action.payload.forEach(file => {
        if (!state.files.find(f => f.id === file.id)) {
          state.files.push(file);
          state.transfers[file.id] = {
            progress: 0,
            speed: 0,
            eta: 0,
            status: 'idle', // idle, waiting, transferring, paused, completed, failed
            receivedChunks: 0,
          };
        }
      });
    },
    updateTransferStatus: (state, action) => {
      const { fileId, status } = action.payload;
      if (state.transfers[fileId]) {
        state.transfers[fileId].status = status;
      }
    },
    updateTransferProgress: (state, action) => {
      const { fileId, progress, speed, eta, receivedChunks } = action.payload;
      if (state.transfers[fileId]) {
        if (progress !== undefined) state.transfers[fileId].progress = progress;
        if (speed !== undefined) state.transfers[fileId].speed = speed;
        if (eta !== undefined) state.transfers[fileId].eta = eta;
        if (receivedChunks !== undefined) state.transfers[fileId].receivedChunks = receivedChunks;
      }
    },
    removeFile: (state, action) => {
      const fileId = action.payload;
      state.files = state.files.filter(file => file.id !== fileId);
      delete state.transfers[fileId];
    },
    resetTransfers: () => initialState,
  },
});

export const { 
  addFiles, 
  updateTransferProgress, 
  updateTransferStatus,
  removeFile,
  resetTransfers 
} = transferSlice.actions;
export default transferSlice.reducer;
