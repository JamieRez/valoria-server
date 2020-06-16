let provider;
let signer;
let currentChat = {};

const valoria = new Valoria({
  server: '/',
  peerHost: 'https://valoria-peer-server-0.herokuapp.com/'
})

async function start(){
  if(!web3 || !web3.currentProvider) return;
  ethereum.enable();
  provider = new ethers.providers.Web3Provider(web3.currentProvider);
  signer = await provider.getSigner();
  const username = sessionStorage.getItem('valoriaUsername');
  const password = sessionStorage.getItem('valoriaPassword')
  if(username && password){
    valoria.register(username, password, (user) => {
      window.user = user;
      startChat();
    });
  }
}

start();

async function joinWithCredentials(username, password){
  if(username.length > 0 && password.length > 0)
  valoria.register(username, password, (user) => {
    sessionStorage.setItem('valoriaUsername', username);
    sessionStorage.setItem('valoriaPassword', password);
    window.user = user;
    startChat()
  });
}

async function joinWithWeb3(){
  const usernameSignature = await signer.provider.send('personal_sign', [
    "valoria",
    await signer.getAddress(),
  ]);
  const passwordSignature = await signer.provider.send('personal_sign', [
    usernameSignature,
    await signer.getAddress(),
  ]);
  valoria.register(usernameSignature, passwordSignature, (user) => {
    sessionStorage.setItem('valoriaUsername', usernameSignature);
    sessionStorage.setItem('valoriaPassword', passwordSignature);
    window.user = user;
    startChat();
  });
}

//AUTH INPUTS AND SUBMIT
$('.valoriaJoinWithWeb3Wallet').on('click', () => {
  joinWithWeb3();
})

$('.valoriaPasswordInput').on('keyup', (e) => {
  if(e.keyCode === 13){
    joinWithCredentials($('.valoriaUsernameInput').val(), $('.valoriaPasswordInput').val());
  }
})

$('.valoriaAuthSubmit').on('click', () => {
  joinWithCredentials($('.valoriaUsernameInput').val(), $('.valoriaPasswordInput').val());
})

async function startChat(){
  $('.valoriaHeader').text("Valoria Chat");
  $('.valoriaSecondHeader').text("Signed in as: " + valoria.user.username);
  $('.valoriaAuth').css('display', 'none');
  $('.valoriaChat').css('display', 'flex');
  loadOnlineUsers();
} 

async function loadOnlineUsers(){
  valoria.getPeers((peers) => {
    $('.chatOnlineList').empty()
    const loaded = {};
    Object.keys(peers).forEach((peerId) => {
      const peer = peers[peerId];
      peers[peerId].peerId = peerId;
      if(loaded[peer.username] || peer.userId === valoria.user.id) return;
      loaded[peer.username] = true;
      let el = document.createElement('div');
      el.className = 'chatOnlineUser hideScrollbar'
      el.textContent = peer.username;
      $(el).on('click', e => connectToPeer(peer));
      $('.chatOnlineList').append(el);
    })
  })
}

async function connectToPeer(peer){
  valoria.getUser({userId: peer.userId, username: peer.username}, (u) => {
    window.thisPeer = u;
    delete currentChat.channel;
    currentChat.userId = u.id;
    $('.chatMsgForm').css('display', 'flex');
    $('.chatVideoBtn').css('display', 'flex');
    $('.chatVideoBtn').on('click', () => {
      navigator.mediaDevices.getUserMedia({video: true, audio: true}).then(function(myStream) {
        console.log(myStream.getVideoTracks());
        $('.chatUserVideo')[0].srcObject = myStream;
        valoria.call(peer.userId, myStream, (theirStream) => {
          $('.chatPeerVideo')[0].srcObject = theirStream;
          console.log(theirStream.getVideoTracks())
          console.log($('.chatPeerVideo')[0])
        });
      })
    })
    valoria.onCall((d) => {
      navigator.mediaDevices.getUserMedia({video: true, audio: true}).then(function(myStream) {
        $('.chatUserVideo')[0].srcObject = myStream;
        valoria.answer(d, myStream, (theirStream) => {
          console.log(myStream.getVideoTracks());
          console.log(theirStream.getVideoTracks())
          $('.chatPeerVideo')[0].srcObject = theirStream;
          console.log($('.chatPeerVideo')[0])
        });
      })
    })
    $('.chatName').text(u.username);
    $('.chatMsgContainerList').empty();
    let loaded = {};
    let allMsgs = [];
    function getMsgsOfUser(data, username){
      data.on((msgTimes) => {
        if(msgTimes && typeof msgTimes === 'object'){
          Object.keys(msgTimes).forEach((time) => {
            if(loaded[username + time]) return;
            let msg = msgTimes[time];
            if(msg && typeof msg === 'string'){
              loaded[username + time] = true;
              allMsgs.push({text: msg, username, time});
              loadMessages(allMsgs);
            }
          })
        }
      });
    }
    getMsgsOfUser(u.get('chat').get('users').get(user.id), u.username);
    getMsgsOfUser(valoria.user.get('chat').get('users').get(u.id), user.username);
  });
}

function loadMessages(msgs){
  $('.chatMsgContainerList').empty();
  msgs.sort((a, b) => a.time - b.time);
  msgs.forEach((msg) => {
    let msgEl = document.createElement('div');
    msgEl.className = 'chatMsg';
    $('.chatMsgContainerList').append(msgEl);
    let msgUandT = document.createElement('div');
    msgUandT.className = 'chatMsgUserAndTime';
    $(msgEl).append(msgUandT)
    let msgUsername = document.createElement('div');
    msgUsername.className = 'chatMsgUsername hideScrollbar';
    msgUsername.textContent = msg.username;
    $(msgUandT).append(msgUsername)
    let msgTime = document.createElement('div');
    msgTime.className = 'chatMsgTime';
    msgTime.textContent = moment(Number(msg.time)).calendar();
    $(msgUandT).append(msgTime)
    let msgText = document.createElement('div');
    msgText.className = 'chatMsgText';
    msgText.textContent = msg.text;
    $(msgEl).append(msgText);
  })
  $('.chatMsgContainerList')[0].scrollTop = $('.chatMsgContainerList')[0].scrollHeight;
}



$('.chatMsgInput').on('keyup', (e) => {
  if(e.keyCode === 13){
    sendMessage($('.chatMsgInput').val())
  }
})

$('.chatMsgInputSubmit').on('click', () => sendMessage($('.chatMsgInput').val()));

async function sendMessage(msg){
  if(msg.length < 1) return;
  $('.chatMsgInput').val('');
  if(currentChat.userId){
    const time = Date.now();
    valoria.user.get('chat').get('users').get(currentChat.userId).get(time).set(msg);
  }
}