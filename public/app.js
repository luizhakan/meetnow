const configuration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

let peerConnection = null;
let localStream = null;
let remoteStream = null;
let roomDialog = null;
let roomId = null;
let cancel = false;

const handleCancel = () => {
  cancel = true;
};

function init() {
  document.querySelector("#cameraBtn").addEventListener("click", openUserMedia);
  document.querySelector("#hangupBtn").addEventListener("click", hangUp);
  document.querySelector("#createBtn").addEventListener("click", createRoom);
  document.querySelector("#joinBtn").addEventListener("click", joinRoom);

  // Initialize MDCDialog only if it exists in the DOM
  const roomDialogElement = document.querySelector("#room-dialog");
  if (roomDialogElement) {
    roomDialog = new mdc.dialog.MDCDialog(roomDialogElement);
  } else {
    console.error("Error: MDCDialog element not found in the DOM.");
  }
}

async function createRoom() {
  document.querySelector("#createBtn").disabled = true;
  document.querySelector("#joinBtn").disabled = true;
  const db = firebase.firestore();

  console.log("Create PeerConnection with configuration: ", configuration);
  peerConnection = new RTCPeerConnection(configuration);

  registerPeerConnectionListeners();

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const roomWithOffer = {
    offer: {
      type: offer.type,
      sdp: offer.sdp,
    },
  };

  const roomRef = await db.collection("rooms").add(roomWithOffer);
  const roomId = roomRef.id;
  document.querySelector(
    "#currentRoom"
  ).innerText = `Current room is ${roomId} - You are the caller!`;

  roomRef.onSnapshot(async (snapshot) => {
    const data = snapshot.data();
    if (!peerConnection.currentRemoteDescription && data.answer) {
      console.log("Got remote description: ", data.answer);
      const rtcSessionDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(rtcSessionDescription);
    }
  });

  async function joinRoomById(roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection("rooms").doc(`${roomId}`);
    const roomSnapshot = await roomRef.get();
    console.log("Sala encontrada:", roomSnapshot.exists);

    if (roomSnapshot.exists) {
      console.log("Criando PeerConnection com a configuração: ", configuration);
      peerConnection = new RTCPeerConnection(configuration);
      registerPeerConnectionListeners();
      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream);
      });

      peerConnection.addEventListener("track", (event) => {
        console.log("Faixa remota recebida:", event.streams[0]);
        event.streams[0].getTracks().forEach((track) => {
          console.log("Adicionar uma faixa ao remoteStream:", track);
          remoteStream.addTrack(track);
        });
      });

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      const roomWithAnswer = {
        answer: {
          type: answer.type,
          sdp: answer.sdp,
        },
      };

      const callenderCandidates = roomRef.collection("callenderCandidates");
      callenderCandidates.onSnapshot((snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === "added") {
            let data = change.doc.data();
            console.log(
              `Got new remote ICE candidate: ${JSON.stringify(data)}`
            );
            await peerConnection.addIceCandidate(new RTCIceCandidate(data));
          }
        });
      });
    }
  }

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });
}

function joinRoom() {
  document.querySelector("#createBtn").disabled = true;
  document.querySelector("#joinBtn").disabled = true;

  document.querySelector("#confirmJoinBtn").addEventListener(
    "click",
    async () => {
      roomId = document.querySelector("#room-id").value;
      console.log("Join room: ", roomId);
      document.querySelector(
        "#currentRoom"
      ).innerText = `Current room is ${roomId} - You are the callee!`;
      await joinRoomById(roomId);
    },
    { once: true }
  );
  roomDialog.open();
}

async function joinRoomById(roomId) {
  const db = firebase.firestore();
  const roomRef = db.collection("rooms").doc(`${roomId}`);
  const roomSnapshot = await roomRef.get();
  console.log("Got room:", roomSnapshot.exists);

  if (roomSnapshot.exists) {
    console.log("Create PeerConnection with configuration: ", configuration);
    peerConnection = new RTCPeerConnection(configuration);
    registerPeerConnectionListeners();
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.addEventListener("track", (event) => {
      console.log("Got remote track:", event.streams[0]);
      event.streams[0].getTracks().forEach((track) => {
        console.log("Add a track to the remoteStream:", track);
        remoteStream.addTrack(track);
      });
    });
  }
}

async function openUserMedia(e) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  document.querySelector("#localVideo").srcObject = stream;
  localStream = stream;
  remoteStream = new MediaStream();
  document.querySelector("#remoteVideo").srcObject = remoteStream;

  console.log("Stream:", document.querySelector("#localVideo").srcObject);
  document.querySelector("#cameraBtn").disabled = true;
  document.querySelector("#joinBtn").disabled = false;
  document.querySelector("#createBtn").disabled = false;
  document.querySelector("#hangupBtn").disabled = false;
}

async function hangUp(e) {
  const tracks = document.querySelector("#localVideo").srcObject.getTracks();
  tracks.forEach((track) => {
    track.stop();
  });

  if (remoteStream) {
    remoteStream.getTracks().forEach((track) => track.stop());
  }

  if (peerConnection) {
    peerConnection.close();
  }

  document.querySelector("#localVideo").srcObject = null;
  document.querySelector("#remoteVideo").srcObject = null;
  document.querySelector("#cameraBtn").disabled = false;
  document.querySelector("#joinBtn").disabled = true;
  document.querySelector("#createBtn").disabled = true;
  document.querySelector("#hangupBtn").disabled = true;
  document.querySelector("#currentRoom").innerText = "";

  if (roomId) {
    const db = firebase.firestore();
    const roomRef = db.collection("rooms").doc(roomId);
    const calleeCandidates = await roomRef.collection("calleeCandidates").get();
    calleeCandidates.forEach(async (candidate) => {
      await candidate.delete();
    });
    const callerCandidates = await roomRef.collection("callerCandidates").get();
    callerCandidates.forEach(async (candidate) => {
      await candidate.delete();
    });
    await roomRef.delete();
  }

  document.location.reload(true);
}

function registerPeerConnectionListeners() {
  peerConnection.addEventListener("icegatheringstatechange", () => {
    console.log(
      `ICE gathering state changed: ${peerConnection.iceGatheringState}`
    );
  });

  peerConnection.addEventListener("connectionstatechange", () => {
    console.log(`Connection state change: ${peerConnection.connectionState}`);
  });

  peerConnection.addEventListener("signalingstatechange", () => {
    console.log(`Signaling state change: ${peerConnection.signalingState}`);
  });

  peerConnection.addEventListener("iceconnectionstatechange ", () => {
    console.log(
      `ICE connection state change: ${peerConnection.iceConnectionState}`
    );
  });
}

init();
