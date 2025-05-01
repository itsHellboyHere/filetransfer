


// WebRTC Configuration
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // Add TURN servers if needed for NAT traversal
        // {
        //     urls: 'turn:your-turn-server.com',
        //     username: 'username',
        //     credential: 'password'
        // }
    ]
};

// Global variables
let peerConnection = null;
let dataChannel = null;
let currentFile = null;
let currentFileSize = 0;
let currentFileName = '';
let currentFileType = '';
let chunksTotal = 0;
let chunksTransferred = 0;
let chunksAcknowledged = 0;
let sessionId = '';
let isSender = false;
let transferStartTime = null;
let lastProgressUpdateTime = null;
let lastProgressBytes = 0;
let sendQueue = [];
let isSending = false;
let chunkSize = 64 * 1024; // Start with 64KB, adjusts dynamically
let receivedChunks = [];
let receivedFileBlob = null;
let transferState = {
    active: false,
    fileIndex: 0,
    chunkIndex: 0
};

// DOM Elements
const fileInput = document.getElementById('fileInput');
const fileDropArea = document.getElementById('fileDropArea');
const fileMessage = document.getElementById('fileMessage');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const fileType = document.getElementById('fileType');
const progressContainer = document.getElementById('progressContainer');
const progressPercent = document.getElementById('progressPercent');
const progressFill = document.getElementById('progressFill');
const speedIndicator = document.getElementById('speedIndicator');
const sessionIdInput = document.getElementById('sessionId');
const copySessionIdBtn = document.getElementById('copySessionId');
const qrCodeContainer = document.getElementById('qrCodeContainer');
const qrCode = document.getElementById('qrCode');
const createBtn = document.getElementById('createBtn');
const cancelSendBtn = document.getElementById('cancelSendBtn');
const sendStatus = document.getElementById('sendStatus');
const connectSessionId = document.getElementById('connectSessionId');
const connectBtn = document.getElementById('connectBtn');
const cancelReceiveBtn = document.getElementById('cancelReceiveBtn');
const receiveStatus = document.getElementById('receiveStatus');
const connectionStatus = document.getElementById('connectionStatus');
const connectionStatusText = document.getElementById('connectionStatusText');
const receiveProgressContainer = document.getElementById('receiveProgressContainer');
const receiveProgressPercent = document.getElementById('receiveProgressPercent');
const receiveProgressFill = document.getElementById('receiveProgressFill');
const receiveSpeedIndicator = document.getElementById('receiveSpeedIndicator');
const receiveFileInfo = document.getElementById('receiveFileInfo');
const receivingFileName = document.getElementById('receivingFileName');
const receivingFileSize = document.getElementById('receivingFileSize');
const downloadBtn = document.getElementById('downloadBtn');

// Initialize the application
function init() {
    setupEventListeners();
    setupDragAndDrop();
    checkForResumableTransfer();
}

// Set up event listeners
function setupEventListeners() {
    // File selection
    fileInput.addEventListener('change', handleFileSelect);

    // Create session button
    createBtn.addEventListener('click', createSession);

    // Cancel send button
    cancelSendBtn.addEventListener('click', cancelTransfer);

    // Connect button
    connectBtn.addEventListener('click', joinSession);

    // Cancel receive button
    cancelReceiveBtn.addEventListener('click', cancelTransfer);

    // Copy session ID button
    copySessionIdBtn.addEventListener('click', copySessionId);

    // Download button
    downloadBtn.addEventListener('click', downloadReceivedFile);

    // Window beforeunload event
    window.addEventListener('beforeunload', handleBeforeUnload);
}

// Set up drag and drop
function setupDragAndDrop() {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        fileDropArea.addEventListener(eventName, preventDefaults, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        fileDropArea.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        fileDropArea.addEventListener(eventName, unhighlight, false);
    });

    fileDropArea.addEventListener('drop', handleDrop, false);
    fileDropArea.addEventListener('click', () => fileInput.click());
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight() {
    fileDropArea.classList.add('active');
}

function unhighlight() {
    fileDropArea.classList.remove('active');
}

// Handle file selection
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        setSelectedFile(file);
    }
}

// Handle file drop
function handleDrop(e) {
    const dt = e.dataTransfer;
    const file = dt.files[0];
    if (file) {
        fileInput.files = dt.files;
        setSelectedFile(file);
    }
}

// Set the selected file and update UI
function setSelectedFile(file) {
    currentFile = file;
    currentFileName = file.name;
    currentFileSize = file.size;
    currentFileType = file.type || 'Unknown';
    chunksTotal = Math.ceil(currentFileSize / chunkSize);
    chunksTransferred = 0;

    // Update UI
    fileMessage.textContent = currentFileName;
    fileName.textContent = currentFileName;
    fileSize.textContent = formatFileSize(currentFileSize);
    fileType.textContent = currentFileType;
    fileInfo.style.display = 'block';

    // Enable create session button
    createBtn.disabled = false;

    // Save file info for potential resume
    saveTransferState();
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Create a new session
async function createSession() {
    try {
        isSender = true;
        transferState.active = true;
        transferState.fileIndex = 0;
        transferState.chunkIndex = 0;

        // Create a new session in Firestore
        const db = firebase.firestore();
        const sessionRef = db.collection('sessions').doc();
        sessionId = sessionRef.id;
        sessionIdInput.value = sessionId;

        // Show QR code (would use a QR code library in production)
        qrCodeContainer.style.display = 'block';
        qrCode.innerHTML = '<i class="fas fa-qrcode" style="font-size: 5rem; color: #adb5bd;"></i>';

        // Create peer connection
        peerConnection = new RTCPeerConnection(rtcConfig);
        registerPeerConnectionListeners()

        // Set up data channel with reliable ordered transfer
        dataChannel = peerConnection.createDataChannel('fileTransfer', {
            ordered: true,
            maxRetransmits: 30 // Increased reliability
        });
        setupDataChannelEvents();

        // Add ICE candidate handler
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                sessionRef.collection('callerCandidates').add(event.candidate.toJSON());
            }
        };

        // Create offer
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
        });
        await peerConnection.setLocalDescription(offer);

        // Save session data
        await sessionRef.set({
            offer: {
                type: offer.type,
                sdp: offer.sdp
            },
            metadata: {
                fileName: currentFileName,
                fileSize: currentFileSize,
                fileType: currentFileType,
                chunksTotal: chunksTotal,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }
        });

        // Listen for answer
        sessionRef.onSnapshot(async (snapshot) => {
            const data = snapshot.data();
            if (!peerConnection.currentRemoteDescription && data && data.answer) {
                const answer = new RTCSessionDescription(data.answer);
                await peerConnection.setRemoteDescription(answer);
            }
        });

        // Listen for receiver's ICE candidates
        sessionRef.collection('calleeCandidates').onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
                }
            });
        });

        // Update UI
        createBtn.disabled = true;
        cancelSendBtn.disabled = false;
        sendStatus.textContent = 'Waiting for receiver to connect...';
        sendStatus.className = 'status info';

        // Save transfer state
        saveTransferState();

    } catch (error) {
        console.error('Error creating session:', error);
        sendStatus.textContent = 'Error creating session: ' + error.message;
        sendStatus.className = 'status error';
        resetSender();
    }
}

// Join an existing session
async function joinSession() {
    try {
        isSender = false;
        sessionId = connectSessionId.value.trim();

        if (!sessionId) {
            receiveStatus.textContent = 'Please enter a session ID';
            receiveStatus.className = 'status error';
            return;
        }

        // Get session reference
        const db = firebase.firestore();
        const sessionRef = db.collection('sessions').doc(sessionId);
        const sessionSnapshot = await sessionRef.get();

        if (!sessionSnapshot.exists) {
            receiveStatus.textContent = 'Session not found';
            receiveStatus.className = 'status error';
            return;
        }

        // Update connection status
        updateConnectionStatus('connecting', 'Connecting...');

        // Create peer connection
        peerConnection = new RTCPeerConnection(rtcConfig);
        registerPeerConnectionListeners()
        // Set up data channel handler
        peerConnection.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannelEvents();
        };

        // Add ICE candidate handler
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                sessionRef.collection('calleeCandidates').add(event.candidate.toJSON());
            }
        };

        // Set remote description from offer
        const offer = sessionSnapshot.data().offer;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

        // Create answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // Save answer
        await sessionRef.update({
            answer: {
                type: answer.type,
                sdp: answer.sdp
            }
        });

        // Listen for sender's ICE candidates
        sessionRef.collection('callerCandidates').onSnapshot((snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
                }
            });
        });

        // Get metadata
        const metadata = sessionSnapshot.data().metadata;
        if (metadata) {
            currentFileName = metadata.fileName;
            currentFileSize = metadata.fileSize;
            currentFileType = metadata.fileType;
            chunksTotal = metadata.chunksTotal || 0;

            receivingFileName.textContent = currentFileName;
            receivingFileSize.textContent = formatFileSize(currentFileSize);
            receiveFileInfo.style.display = 'block';
        }

        // Update UI
        connectBtn.disabled = true;
        cancelReceiveBtn.disabled = false;
        updateConnectionStatus('connected', 'Connected');
        receiveStatus.textContent = 'Connected to sender. Waiting for file...';
        receiveStatus.className = 'status info';

    } catch (error) {
        console.error('Error joining session:', error);
        receiveStatus.textContent = 'Error joining session: ' + error.message;
        receiveStatus.className = 'status error';
        updateConnectionStatus('disconnected', 'Disconnected');
        resetReceiver();
    }
}

// Set up data channel events
function setupDataChannelEvents() {
    receivedChunks = [];
    let receivedFileSize = 0;
    let receivedFileName = '';
    let receivedFileType = '';
    let lastChunkTime = Date.now();
    let lastChunkSize = 0;
    let totalReceivedBytes = 0;

    // Configure buffer thresholds
    dataChannel.bufferedAmountLowThreshold = 1024 * 1024; // 1MB

    dataChannel.onopen = () => {
        if (isSender) {
            // Start sending file when data channel opens
            sendStatus.textContent = `Sending ${currentFileName}...`;
            sendStatus.className = 'status info';
            progressContainer.style.display = 'block';
            transferStartTime = Date.now();
            lastProgressUpdateTime = Date.now();
            lastProgressBytes = 0;

            // First send metadata
            const metadata = {
                type: 'metadata',
                fileName: currentFileName,
                fileSize: currentFileSize,
                fileType: currentFileType,
                chunksTotal: chunksTotal
            };
            dataChannel.send(JSON.stringify(metadata));

            // Then start sending chunks
            sendNextChunk();
        } else {
            // Ready to receive file
            receiveStatus.textContent = 'Ready to receive file...';
            receiveStatus.className = 'status info';
            receiveProgressContainer.style.display = 'block';
            transferStartTime = Date.now();
            lastProgressUpdateTime = Date.now();
            lastProgressBytes = 0;
        }
    };

    dataChannel.onmessage = async (event) => {
        if (!isSender) {
            // Receiver logic
            if (typeof event.data === 'string') {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'metadata') {
                        // Handle metadata
                        receivedFileName = message.fileName;
                        receivedFileSize = message.fileSize;
                        receivedFileType = message.fileType;
                        chunksTotal = message.chunksTotal || 0;

                        receivingFileName.textContent = receivedFileName;
                        receivingFileSize.textContent = formatFileSize(receivedFileSize);
                        receiveFileInfo.style.display = 'block';

                        // Send metadata ACK
                        dataChannel.send(JSON.stringify({
                            type: 'ack',
                            chunkId: 'metadata'
                        }));
                    }
                } catch (e) {
                    console.error('Error parsing message:', e);
                }
            } else {
                // Handle binary chunks
                const now = Date.now();
                const chunkSize = event.data.byteLength;
                lastChunkSize = chunkSize;
                lastChunkTime = now;
                totalReceivedBytes += chunkSize;

                receivedChunks.push(event.data);
                chunksTransferred++;

                // Send chunk ACK
                dataChannel.send(JSON.stringify({
                    type: 'chunk-ack',
                    chunkId: chunksTransferred,
                    receivedBytes: chunkSize
                }));

                updateReceiveProgress(receivedChunks.length / chunksTotal, chunkSize);

                // Final chunk received - verify and send final ACK
                if (receivedChunks.length === chunksTotal) {
                    await reconstructReceivedFile(receivedChunks, receivedFileName, receivedFileType);
                }
            }
        } else {
            // Sender logic
            if (typeof event.data === 'string') {
                try {
                    const message = JSON.parse(event.data);

                    if (message.type === 'chunk-ack') {
                        chunksAcknowledged++;
                        adjustChunkSize();
                    }
                    else if (message.type === 'transfer-complete') {
                        // Handle final transfer confirmation
                        if (message.success) {
                            sendStatus.textContent = 'Transfer verified by receiver!';
                            sendStatus.className = 'status success';
                        } else {
                            sendStatus.textContent = `Receiver reported error: ${message.error}`;
                            sendStatus.className = 'status error';
                        }

                        // Graceful closure
                        setTimeout(() => {
                            if (dataChannel.readyState === 'open') {
                                dataChannel.close();
                            }
                            transferState.active = false;
                        }, 1000);
                    }

                } catch (e) {
                    console.error('Error parsing ACK:', e);
                }
            }
        }
    };


    dataChannel.onbufferedamountlow = () => {
        // Buffer has space again, try to send queued chunks
        while (sendQueue.length > 0) {
            try {
                const chunk = sendQueue.shift();
                dataChannel.send(chunk);
                chunksTransferred++;
                updateSendProgress(chunksTransferred / chunksTotal, chunk.byteLength);
            } catch (e) {
                // Buffer full again, stop trying
                sendQueue.unshift(chunk); // Put back the chunk we couldn't send
                break;
            }
        }

        // Continue with normal sending if queue is empty
        if (sendQueue.length === 0 && isSender) {
            sendNextChunk();
        }
    };

    dataChannel.onclose = () => {
        if (isSender) {
            sendStatus.textContent = 'Connection closed';
            sendStatus.className = 'status';
        } else {
            receiveStatus.textContent = 'Connection closed';
            receiveStatus.className = 'status';
            updateConnectionStatus('disconnected', 'Disconnected');
        }
    };

    dataChannel.onerror = (error) => {
        console.error('Data channel error:', error);
        if (isSender) {
            sendStatus.textContent = 'Transfer error: ' + error.message;
            sendStatus.className = 'status error';
        } else {
            receiveStatus.textContent = 'Transfer error: ' + error.message;
            receiveStatus.className = 'status error';
            updateConnectionStatus('disconnected', 'Disconnected');
        }
    };
}

// Send file in chunks with flow control
function sendNextChunk() {
    if (!currentFile || chunksTransferred >= chunksTotal) {
        // Transfer complete
        if (sendQueue.length === 0) {
            sendStatus.textContent = 'File transfer complete!';
            sendStatus.className = 'status success';
            // dataChannel.close();
            // transferState.active = false;
            // clearTransferState();
            // startFinalAckTimeout();
        }
        return;
    }

    if (isSending) return; // Don't send more if we're waiting

    const offset = chunksTransferred * chunkSize;
    const chunk = currentFile.slice(offset, offset + chunkSize);

    const fileReader = new FileReader();
    fileReader.onload = (event) => {
        try {
            const arrayBuffer = event.target.result;
            isSending = true;

            // Try to send immediately
            try {
                dataChannel.send(arrayBuffer);
                chunksTransferred++;
                updateSendProgress(chunksTransferred / chunksTotal, arrayBuffer.byteLength);
                isSending = false;

                // Save progress for potential resume
                transferState.chunkIndex = chunksTransferred;
                saveTransferState();

                // Schedule next chunk with small delay to allow ACKs
                setTimeout(sendNextChunk, 10);
            } catch (e) {
                // If buffer is full, add to queue and wait for buffer to drain
                sendQueue.push(arrayBuffer);
                isSending = false;
            }
        } catch (error) {
            console.error('Error sending chunk:', error);
            sendStatus.textContent = 'Transfer error: ' + error.message;
            sendStatus.className = 'status error';
            isSending = false;
        }
    };

    fileReader.onerror = (error) => {
        console.error('File read error:', error);
        sendStatus.textContent = 'File read error: ' + error.message;
        sendStatus.className = 'status error';
        isSending = false;
    };

    fileReader.readAsArrayBuffer(chunk);
}

let finalAckTimeout;

function startFinalAckTimeout() {
    finalAckTimeout = setTimeout(() => {
        if (transferState.active) {
            sendStatus.textContent = 'Receiver confirmation timeout!';
            sendStatus.className = 'status error';
            if (dataChannel.readyState === 'open') {
                dataChannel.close();
            }
            transferState.active = false;
        }
    }, 30000); // 30 second timeout
}

function cancelFinalAckTimeout() {
    if (finalAckTimeout) {
        clearTimeout(finalAckTimeout);
        finalAckTimeout = null;
    }
}


// Adjust chunk size based on network conditions
function adjustChunkSize() {
    // Simple dynamic chunk sizing - can be made more sophisticated
    const targetChunksInFlight = 5; // Number of chunks we want to have in transit

    // Calculate average transfer time (simple implementation)
    const now = Date.now();
    const timeSinceStart = (now - transferStartTime) / 1000;
    const avgTransferTime = timeSinceStart / chunksAcknowledged;

    if (avgTransferTime < 100) {
        // Fast network, increase chunk size
        chunkSize = Math.min(256 * 1024, chunkSize * 1.5);
    } else if (avgTransferTime > 500) {
        // Slow network, decrease chunk size
        chunkSize = Math.max(16 * 1024, chunkSize * 0.8);
    }
}

// Update send progress
function updateSendProgress(progress, bytesTransferred) {
    const percent = Math.round(progress * 100);
    progressPercent.textContent = `${percent}%`;
    progressFill.style.width = `${percent}%`;

    // Calculate transfer speed
    const now = Date.now();
    const timeElapsed = (now - transferStartTime) / 1000; // in seconds
    const totalBytesTransferred = Math.floor(progress * currentFileSize);

    if (timeElapsed > 0) {
        const speed = totalBytesTransferred / timeElapsed; // bytes per second
        speedIndicator.textContent = `Speed: ${formatSpeed(speed)}`;
    }

    // Update more frequently at the beginning
    if (now - lastProgressUpdateTime > 1000 || progress === 1) {
        lastProgressUpdateTime = now;
        lastProgressBytes = totalBytesTransferred;
    }
}

// Update receive progress
function updateReceiveProgress(progress, bytesReceived) {
    const percent = Math.round(progress * 100);
    receiveProgressPercent.textContent = `${percent}%`;
    receiveProgressFill.style.width = `${percent}%`;

    // Calculate transfer speed
    const now = Date.now();
    const timeElapsed = (now - transferStartTime) / 1000; // in seconds
    const totalBytesReceived = Math.floor(progress * currentFileSize);

    if (timeElapsed > 0) {
        const speed = totalBytesReceived / timeElapsed; // bytes per second
        receiveSpeedIndicator.textContent = `Speed: ${formatSpeed(speed)}`;
    }

    // Update more frequently at the beginning
    if (now - lastProgressUpdateTime > 1000 || progress === 1) {
        lastProgressUpdateTime = now;
        lastProgressBytes = totalBytesReceived;
    }

    // Transfer complete
    if (progress === 1) {
        receiveStatus.textContent = 'File transfer complete!';
        receiveStatus.className = 'status success';
        updateConnectionStatus('connected', 'Transfer Complete');
    }
}

// Format speed
function formatSpeed(bytesPerSecond) {
    if (bytesPerSecond < 1024) {
        return `${bytesPerSecond.toFixed(0)} B/s`;
    } else if (bytesPerSecond < 1024 * 1024) {
        return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    } else {
        return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
    }
}



// Reconstruct received file from chunks
async function reconstructReceivedFile(chunks, fileName, fileType) {
    try {

        receivedFileBlob = new Blob(chunks, { type: fileType });
        // Verify file size matches expected
        // if (receivedFileBlob.size < currentFileSize) {
        //     throw new Error(`File size mismatch (expected ${currentFileSize}, got ${receivedFileBlob.size})`);
        // }

        // Send final success ACK to sender
        dataChannel.send(JSON.stringify({
            type: 'transfer-complete',
            success: true,
            fileName: fileName,
            fileSize: receivedFileBlob.size
        }));
        // Show download button
        downloadBtn.style.display = 'inline-flex';

        // Update UI
        receiveStatus.textContent = 'File ready to download!';
        receiveStatus.className = 'status success';


    } catch (error) {
        console.error('Error reconstructing file:', error);
        receiveStatus.textContent = 'Error reconstructing file: ' + error.message;
        receiveStatus.className = 'status error';
    }
}





// Download received file
function downloadReceivedFile() {
    if (!receivedFileBlob) return;

    const url = URL.createObjectURL(receivedFileBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = currentFileName || 'received_file';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 100);
}

// Update connection status
function updateConnectionStatus(status, text) {
    connectionStatus.className = `status-indicator ${status}`;
    connectionStatusText.textContent = text;
}

// Copy session ID to clipboard
function copySessionId() {
    sessionIdInput.select();
    document.execCommand('copy');

    // Show feedback
    const originalText = copySessionIdBtn.innerHTML;
    copySessionIdBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    setTimeout(() => {
        copySessionIdBtn.innerHTML = originalText;
    }, 2000);
}

// Cancel transfer
function cancelTransfer() {
    cancelFinalAckTimeout()
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    if (isSender) {
        resetSender();
    } else {
        resetReceiver();
    }

    // Clean up any ongoing transfer state
    transferState.active = false;
    clearTransferState();
}

// Reset sender UI
function resetSender() {
    currentFile = null;
    fileInput.value = '';
    fileMessage.textContent = 'No file selected';
    fileInfo.style.display = 'none';
    progressContainer.style.display = 'none';
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';
    speedIndicator.textContent = '-';
    qrCodeContainer.style.display = 'none';
    createBtn.disabled = true;
    cancelSendBtn.disabled = true;
    sendStatus.textContent = '';
    sendStatus.className = 'status';

    // Reset transfer state
    chunksTransferred = 0;
    chunksAcknowledged = 0;
    sendQueue = [];
    isSending = false;
}

// Reset receiver UI
function resetReceiver() {
    connectSessionId.value = '';
    receiveFileInfo.style.display = 'none';
    receiveProgressContainer.style.display = 'none';
    receiveProgressFill.style.width = '0%';
    receiveProgressPercent.textContent = '0%';
    receiveSpeedIndicator.textContent = '-';
    connectBtn.disabled = false;
    cancelReceiveBtn.disabled = true;
    downloadBtn.style.display = 'none';
    receivedFileBlob = null;
    receiveStatus.textContent = '';
    receiveStatus.className = 'status';
    updateConnectionStatus('disconnected', 'Disconnected');

    // Reset transfer state
    chunksTransferred = 0;
    receivedChunks = [];
}

// Save transfer state to localStorage
function saveTransferState() {
    if (!isSender || !transferState.active) return;

    const state = {
        sessionId,
        fileName: currentFileName,
        fileSize: currentFileSize,
        fileType: currentFileType,
        chunksTotal,
        chunksTransferred,
        chunkSize,
        timestamp: Date.now()
    };

    localStorage.setItem('fileTransferState', JSON.stringify(state));
}

// Check for resumable transfer on page load
function checkForResumableTransfer() {
    const state = localStorage.getItem('fileTransferState');
    if (state) {
        try {
            const parsed = JSON.parse(state);
            // Check if transfer is recent (within last hour)
            if (Date.now() - parsed.timestamp < 3600000) {
                if (confirm('You have an unfinished transfer. Would you like to resume?')) {
                    // Load transfer state
                    sessionId = parsed.sessionId;
                    currentFileName = parsed.fileName;
                    currentFileSize = parsed.fileSize;
                    currentFileType = parsed.fileType;
                    chunksTotal = parsed.chunksTotal;
                    chunksTransferred = parsed.chunksTransferred;
                    chunkSize = parsed.chunkSize;

                    // Update UI
                    fileMessage.textContent = currentFileName;
                    fileName.textContent = currentFileName;
                    fileSize.textContent = formatFileSize(currentFileSize);
                    fileType.textContent = currentFileType;
                    fileInfo.style.display = 'block';
                    createBtn.disabled = false;

                    // Set transfer as active
                    transferState.active = true;
                    transferState.chunkIndex = chunksTransferred;
                } else {
                    clearTransferState();
                }
            } else {
                clearTransferState();
            }
        } catch (e) {
            console.error('Error parsing transfer state:', e);
            clearTransferState();
        }
    }
}

// Clear transfer state from localStorage
function clearTransferState() {
    localStorage.removeItem('fileTransferState');
    transferState.active = false;
}

// Handle beforeunload event
function handleBeforeUnload(e) {
    if (transferState.active) {
        e.preventDefault();
        e.returnValue = 'You have an active file transfer. Are you sure you want to leave?';
        return e.returnValue;
    }
}

function registerPeerConnectionListeners() {
    peerConnection.addEventListener('icegatheringstatechange', () => {
        console.log(
            `ICE gathering state changed: ${peerConnection.iceGatheringState}`);
    });

    peerConnection.addEventListener('connectionstatechange', () => {
        console.log(`Connection state change: ${peerConnection.connectionState}`);
    });

    peerConnection.addEventListener('signalingstatechange', () => {
        console.log(`Signaling state change: ${peerConnection.signalingState}`);
    });

    peerConnection.addEventListener('iceconnectionstatechange ', () => {
        console.log(
            `ICE connection state change: ${peerConnection.iceConnectionState}`);
    });
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);