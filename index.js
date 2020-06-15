
const express= require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);
const bodyParser = require('body-parser');
const { Crypto } = require("node-webcrypto-ossl");
const crypto = new Crypto();
const util = require('util');
require('dotenv').config();

app.set('views', 'client')
app.set('view engine', 'pug');
app.use(express.json())
app.use(express.static('client'));
app.get('/', (req, res) => res.render('index.pug'));

const port = process.env.PORT || 80;

const fs = require('fs');
const AWS = require('aws-sdk');
let s3 = null;
let data = {
  online: {},
  users: {},
  peers: {},
  dimensions: {}
};

if(!process.env.AWS_ACCESS_KEY_ID){
  try {
    let d = fs.readFileSync('./data/data.json', 'utf8');
    if(d) Object.assign(data, JSON.parse(d));
  } catch {
    fs.mkdirSync('./data/', {recursive : true});
    fs.writeFileSync('data/data.json', data, {flag: 'a'});
  }
  data.online = {};
  saveData(data, () => {
    startSocketIO();
  });
} else {
  AWS.config.update({region: 'us-west-1'});
  s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  });
  s3.getObject({Bucket : process.env.S3_BUCKET, Key : "data.json"}, function(err, fileData) {
    if(err) {
      data = {
        "users": {},
        "online": {},
        "peers": {},
        "dimensions": {}
      }
      saveData(data, () => {
        startSocketIO();
      })
    }else{
      data = JSON.parse(fileData.Body.toString());
      data.online = {};
      data.peers = {};
      saveData(data, () => {
        startSocketIO();
      });
    }
  });
}

function saveData(data, cb) {
  if(!process.env.AWS_ACCESS_KEY_ID){
    fs.writeFile('./data/data.json', JSON.stringify(data, null, 2), function (err) {
      if (err) return console.log(err);
      if(cb && typeof cb == 'function') cb();
    });
  }else {
    s3.upload({Bucket : process.env.S3_BUCKET, Key : "data.json", Body : JSON.stringify(data, null, 2)}, (err, fileData) => {
      if (err) console.error(`Upload Error ${err}`);
      if(cb && typeof cb == 'function') cb();
    });
  }
}

server.listen(port, () => {
  console.log("Listening on Port " + port);
});

app.set('views', './client');
app.set('view engine', 'pug');
app.use(express.json());
app.use(express.static('client'));
app.use(bodyParser.json());//json parser
app.use(bodyParser.urlencoded({ extended: true }));//urlencoded parser

app.get('/', (req, res) => {
  res.render('index.pug');
});

function base64ToArrayBuffer(dataUrl, cb) {  
  return Uint8Array.from(atob(dataUrl), c => c.charCodeAt(0))
}

function startSocketIO(){
  io.on('connection', function (socket) {
    socket.on('Create User', (d) => {
      if(!data.users[d.userName]){
        data.users[d.username] = {};
      }
      if(!data.users[d.username][d.userId]){
        const dimension = d.dimension || "valoria";
        data.users[d.username][d.userId] = {
          username : d.username,
          id: d.userId,
          peers: {},
          sockets: {},
          name: d.username,
          eKey: d.eKey,
          keyPair: d.keyPair,
          dimension: dimension
        }
        data.users[d.username][d.userId].peers[d.peerId] = d.peerId;
        data.users[d.username][d.userId].sockets[socket.id] = socket.id;
        if(!data.dimensions[dimension]){
          data.dimensions[dimension] = { peers: {}, sockets: {} };
        }
        data.dimensions[dimension].peers[d.peerId] = {
          username : d.username,
          userId : d.userId,
          socket : socket.id,
        };
        data.dimensions[dimension].sockets[socket.id] = {
          username : d.username,
          peerId : d.peerId,
          userId : d.userId,
        };
        data.online[socket.id] = {
          username : d.username,
          peerId : d.peerId,
          userId : d.userId,
          dimension : dimension
        };
        Object.keys(data.dimensions[dimension].sockets).forEach((socketId) => {
          io.to(socketId).emit("New Peer in Dimension", {
            username : d.username,
            userId : d.userId,
            socket : socket.id,
            peerId : d.peerId
          });
        })
        saveData(data, () => {
          socket.emit("Create User", {success : true, ...d});
        });
      }else {
        socket.emit("Create User", {...d, err : "User already Exists"});
      }
    });
  
  
    socket.on('Get User', (d) => {
      if(data.users[d.username] && data.users[d.username][d.userId]){
        socket.emit("Get User", data.users[d.username][d.userId]);
      }else {
        socket.emit("Get User", {...d, err : "User Does Not Exist"});
      }
    });

    socket.on('Login User', async (d) => {
      if(data.users[d.username] && data.users[d.username][d.userId]){
        const publicKey = await crypto.subtle.importKey(
          "jwk", 
          JSON.parse(data.users[d.username][d.userId].keyPair.publicKey), {
          name: "ECDSA",
          namedCurve: "P-384"
        }, true, ['verify']);
        d.encoded = Uint8Array.from(Object.values(d.encoded));
        const isUser = await crypto.subtle.verify({
          name: "ECDSA",
          hash: {name: "SHA-384"},
        }, publicKey, d.signature, d.encoded);
        if(isUser){
          const dimension = d.dimension || "valoria";
          data.users[d.username][d.userId].peers[d.peerId] = d.peerId;
          data.users[d.username][d.userId].sockets[socket.id] = socket.id;
          data.users[d.username][d.userId].dimension = dimension;
          if(!data.dimensions[dimension]){
            data.dimensions[dimension] = { peers: {}, sockets: {} };
          }
          data.dimensions[dimension].peers[d.peerId] = {
            username : d.username,
            userId : d.userId,
            socket : socket.id,
          };
          data.dimensions[dimension].sockets[socket.id] = {
            username : d.username,
            peerId : d.peerId,
            userId : d.userId,
          };
          data.online[socket.id] = {
            username : d.username,
            peerId : d.peerId,
            userId : d.userId,
            dimension : dimension
          };
          Object.keys(data.dimensions[dimension].sockets).forEach((socketId) => {
            io.to(socketId).emit("New Peer in Dimension", {
              username : d.username,
              userId : d.userId,
              socket : socket.id,
              peerId : d.peerId
            });
          })
          saveData(data, () => {
            socket.emit("Login User", {success : true, ...d});
          });
        }
      }else{
        socket.emit("Login User", {...d, err : "User Does Not Exist"});
      }
    })

    socket.on('disconnect', () => {
      if(data.online[socket.id]){
        let username = data.online[socket.id].username;
        let peerId = data.online[socket.id].peerId;
        let userId = data.online[socket.id].userId;
        if(username && data.users[username] && userId && data.users[username][userId]){
          delete data.users[username][userId].sockets[socket.id];
          delete data.users[username][userId].peers[peerId];
          let dimension = data.users[username][userId].dimension;
          if(data.dimensions[dimension].peers[peerId]){
            delete data.dimensions[dimension].peers[peerId];
          }
          if(data.dimensions[dimension].sockets[socket.id]){
            delete data.dimensions[dimension].sockets[socket.id];
          }
          Object.keys(data.dimensions[dimension].sockets).forEach((socketId) => {
            io.to(socketId).emit("Peer Has Left Dimension", peerId);
          })
        }
        delete data.peers[peerId];
        delete data.online[socket.id];
        saveData(data);
      }
    });

    socket.on("Get Peers in Dimension", (dimId) => {
      if(!dimId) dimId = 'valoria';
      if(data.online[socket.id] && data.dimensions[dimId]){
        socket.emit("Get Peers in Dimension", data.dimensions[dimId].peers);
      }else if(!data.dimensions[dimId]){
        data.dimensions[dimId] = {peers : {}};
        saveData(data);
      }
    })


    //MUST FIX THIS
    function saveDataToPath(data, userId, path, value){
      let thisKey = Object.keys(path)[0];
      let uniqueObjPath = {}
      recurseSaveAndSendAccordingly(thisKey, data, path, {}, uniqueObjPath);
      function recurseSaveAndSendAccordingly(key, data, lPath, lData, lObjPath){    
        // EXAMPLE DATA {chat : {users : {james : {14783482: "My Messages"}}}}
        let nextKey = Object.keys(lPath[key])[0]
        if(lPath[key] && typeof lPath[key] === 'object' && lPath[key][nextKey]){ //IF PATH HAS A KEY
          if(!data[key]){
            if(typeof data[key] !== 'object'){//IF THE DATA DOES NOT HAVE THIS KEY, THAT MEANS ITS NEW.
              data[key] = {};
            } 
            Object.assign(lData, data);
            let uniquePath = userId + JSON.stringify(uniqueObjPath)
            io.to(uniquePath).emit("Get User Data", {data: lData, path: uniquePath});
          }
          lData[key] = {};
          if(lPath && typeof lPath[key] === 'object'){
            if(!lObjPath || typeof lObjPath !== 'object') lObjPath = {[key] : null};
            let newKey = Object.keys(lPath[key])[0]
            lObjPath[key] = {[newKey] : null};
            recurseSaveAndSendAccordingly(newKey, data[key], lPath[key], lData[key], lObjPath[key]);      
          }
        }else{//IF PATH DOES NOT HAVE A KEY THAT MEANS THIS IS WHERE THE NEW VALUE IS ADDED
          if(!data[key] || typeof data[key] !== 'object'){
            data[key] = {};
          }
          if(!lData[key] || typeof lData[key] !== 'object'){
            lData[key] = {};
          }
          lData[key][nextKey] = value;
          data[key][nextKey] = value;
          uniquePath = userId + JSON.stringify(uniqueObjPath)
          io.to(uniquePath).emit("Get User Data", {data: data[key], path: uniquePath});
          lPath[key] = null;
          lObjPath[key] = {[nextKey] : null}
          uniquePath = userId + JSON.stringify(uniqueObjPath)
          io.to(uniquePath).emit("Get User Data", {data: value, path: uniquePath});
        }
        
      }
      return data;
    }

    socket.on("Save User Data", async (d) => {
      if(data.online[socket.id]){
        if(!process.env.AWS_ACCESS_KEY_ID){
          let userData;
          try {
           userData = require(`./data/${d.userId}.json`);
          } catch {
            userData = {};
          }
          saveDataToPath(userData, d.userId, d.path, d.data);
          fs.writeFile(`./data/${d.userId}.json`, JSON.stringify(userData, null, 2), function (err) {
            if (err) return console.log(err);
          });
        }else {
          s3.getObject({Bucket : process.env.S3_BUCKET, Key : `${d.userId}.json`}, function(err, userData) {
            if(err) console.log("S3 Err: ", err);
            if(userData){
              userData = JSON.parse(userData.Body.toString());
              saveDataToPath(userData, d.userId, d.path, d.data)
              s3.upload({Bucket : process.env.S3_BUCKET, Key : `${d.userId}.json`, Body : JSON.stringify(userData, null, 2)}, (err, fileData) => {
                if (err) console.error(`Upload Error ${err}`);
              });
            }
          })
        }
      }
    })

    function getDataFromPath(d, path){
      let thisKey = Object.keys(path)[0];
      while(path[thisKey] && typeof path[thisKey] === 'object'){
        if(!d[thisKey] || typeof d[thisKey] !== 'object'){
          d[thisKey] = {};
        }
        path = path[thisKey];
        let prevKey = thisKey;
        thisKey = Object.keys(path)[0];
        if(path[thisKey]){
          d[prevKey][thisKey] = d[prevKey][thisKey] || {};
        }
        d = d[prevKey];
      }
      if(typeof d !== 'object'){
        d = {};
      }
      d = d[thisKey];
      if(d && typeof d === 'object'){
        Object.keys(d).forEach((key) => {
          if(d[key] && typeof d[key] === 'object'){
            d[key] = {};
          }
        })
      }
      return d;
    }

    socket.on("Get User Data", async(d) => {
      if(data.users[d.username] && data.users[d.username][d.userId]){
        const uniquePath = d.userId + JSON.stringify(d.path)
        socket.join(uniquePath);
        if(!process.env.AWS_ACCESS_KEY_ID){
          let userData = "{}";
          try {
            userData = fs.readFileSync(`./data/${d.userId}.json`, 'utf8')
          } catch {
            fs.writeFileSync(`./data/${d.userId}.json`, '{}', {flag: 'a'});
          }
          let thisData = getDataFromPath(JSON.parse(userData), d.path);
          socket.emit("Get User Data", {data: thisData, path: uniquePath});
        }else{
          s3.getObject({Bucket : process.env.S3_BUCKET, Key : `${d.userId}.json`}, function(err, fileData) {
            if(err) console.log("S3 Err: ", err);
            if(fileData){
              fileData = fileData.Body.toString();
            }
            socket.emit("Get User Data", {data: fileData, path: uniquePath})
          })
        }
      }
    })

  })
};

