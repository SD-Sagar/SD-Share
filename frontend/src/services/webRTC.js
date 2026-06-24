import { io } from 'socket.io-client';

const WEBRTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

class WebRTCManager {
  constructor() {
    this.socket = null;
    this.peerConnection = null;
    this.dataChannel = null;
    this.roomCode = null;
    this.isCreator = false;
    this.onChannelOpen = null;
    this.onChannelMessage = null;
    this.onPeerJoin = null;
    this.onPeerLeave = null;
  }

  connectSocket(url) {
    if (!this.socket) {
      this.socket = io(url || 'http://localhost:5000');
      this.setupSocketListeners();
    }
  }

  setupSocketListeners() {
    this.socket.on('room-created', (roomCode) => {
      this.roomCode = roomCode;
      this.isCreator = true;
      console.log(`Created room: ${roomCode}`);
    });

    this.socket.on('room-joined', (roomCode) => {
      this.roomCode = roomCode;
      this.isCreator = false;
      console.log(`Joined room: ${roomCode}`);
    });

    this.socket.on('peer-joined', (peerId) => {
      console.log(`Peer joined: ${peerId}`);
      if (this.onPeerJoin) this.onPeerJoin(peerId);
      if (this.isCreator) {
        this.initiateCall();
      }
    });

    this.socket.on('peer-left', (peerId) => {
      console.log(`Peer left: ${peerId}`);
      if (this.onPeerLeave) this.onPeerLeave(peerId);
      this.resetConnection();
    });

    this.socket.on('webrtc-offer', async ({ senderId, offer }) => {
      if (this.isCreator) return; // Sender doesn't receive offers in V1
      await this.handleOffer(offer);
    });

    this.socket.on('webrtc-answer', async ({ senderId, answer }) => {
      if (!this.isCreator) return; 
      await this.handleAnswer(answer);
    });

    this.socket.on('ice-candidate', async ({ senderId, candidate }) => {
      await this.handleIceCandidate(candidate);
    });
  }

  joinRoom(roomCode, mode) {
    this.socket.emit('join-room', { roomCode, mode });
  }

  createPeerConnection() {
    if (this.peerConnection) this.peerConnection.close();
    
    this.peerConnection = new RTCPeerConnection(WEBRTC_CONFIG);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', {
          roomCode: this.roomCode,
          candidate: event.candidate,
        });
      }
    };

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.dataChannel.binaryType = 'arraybuffer';
      this.dataChannel.bufferedAmountLowThreshold = 1024 * 1024; // 1MB threshold
      this.setupDataChannel();
    };
  }

  async initiateCall() {
    this.createPeerConnection();
    
    // Create Data Channel before offer
    this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
      negotiated: false
    });
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = 1024 * 1024; // 1MB threshold
    this.setupDataChannel();

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    
    this.socket.emit('webrtc-offer', {
      roomCode: this.roomCode,
      offer,
    });
  }

  async handleOffer(offer) {
    this.createPeerConnection();
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    
    this.socket.emit('webrtc-answer', {
      roomCode: this.roomCode,
      answer,
    });
  }

  async handleAnswer(answer) {
    if (this.peerConnection) {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  async handleIceCandidate(candidate) {
    if (this.peerConnection) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('Error adding ICE candidate', e);
      }
    }
  }

  setupDataChannel() {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      console.log('Data channel opened');
      if (this.onChannelOpen) this.onChannelOpen();
    };

    this.dataChannel.onmessage = (event) => {
      if (this.onChannelMessage) this.onChannelMessage(event.data);
    };

    this.dataChannel.onbufferedamountlow = () => {
      if (this.onBufferedAmountLow) this.onBufferedAmountLow();
    };

    this.dataChannel.onclose = () => {
      console.log('Data channel closed');
    };
  }

  async waitForBuffer() {
    if (!this.dataChannel) return;
    if (this.dataChannel.bufferedAmount < this.dataChannel.bufferedAmountLowThreshold) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let resolved = false;

      const finish = () => {
        if (!resolved) {
          resolved = true;
          this.onBufferedAmountLow = null;
          resolve();
        }
      };

      this.onBufferedAmountLow = finish;

      // Fallback polling loop to fix Chrome bug where event drops during massive streams
      const checkBuffer = () => {
        if (resolved) return;
        if (this.dataChannel && this.dataChannel.bufferedAmount < this.dataChannel.bufferedAmountLowThreshold) {
          finish();
        } else {
          setTimeout(checkBuffer, 50); // Poll every 50ms
        }
      };
      
      setTimeout(checkBuffer, 50);
    });
  }

  sendData(data) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(data);
    } else {
      console.error('Data channel is not open');
    }
  }

  resetConnection() {
    if (this.dataChannel) this.dataChannel.close();
    if (this.peerConnection) this.peerConnection.close();
    this.dataChannel = null;
    this.peerConnection = null;
  }
}

const webrtcService = new WebRTCManager();
export default webrtcService;
