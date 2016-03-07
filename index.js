
var os = require("os");

if (['linux','darwin'].indexOf(os.platform()) < 0 )
  return module.exports = { mesh : (m, cbExt) => cbExt(new Error("unsupported platform"))}

var net = require('net')
var lob = require('lob-enc');
var fs = require('fs.extra');
var path = require('path');


exports.Buffer = Buffer;
exports.name = 'nix-domain';

function error(err)
{
  console.error(err);
  process.exit(1);
}

// add our transport to this new mesh
exports.mesh = function(mesh, cbExt)
{
  var args = mesh.args||{};
  var telehash = mesh.lib;
  var tp = {pipes : {}}
  var base_dir = `/tmp/telehash_nix_domain/`
  fs.mkdirRecursiveSync(base_dir)
  try {
    fs.unlinkSync(base_dir + mesh.hashname)
  } catch (e) {}

  
  tp.server = net.createServer(function connect(sock) {
    //console.log("got domain socket")
    tp.pipe(false, {
      type: 'nix-domain',
      fd: sock._handle.fd
    }, function(pipe) {
      //console.log("pipe?")
      pipe.use(sock);
    });
  });

  tp.server.on('error', function(err) {
    //console.log(err)
  });

  // turn a path into a pipe
  tp.pipe = function(link, path, cbPipe) {
    if (typeof path != 'object' || path.type != 'nix-domain') return false;
    var id = path.fd;
    var pipe = tp.pipes[id];
    if (pipe) return cbPipe(pipe);
    //console.log("new pipe with keepalive", exports.keepalive)
    pipe = new telehash.Pipe('nix-domain',  exports.keepalive);
    tp.pipes[id] = pipe;
    pipe.id = id;
    pipe.path = path;

    // util to add/use this socket
    pipe.use = function(sock) {
      //console.log("use sock")
      pipe.chunks = lob.chunking({}, function receive(err, packet) {
        if (packet) {
          if (!(packet instanceof exports.Buffer))
            packet = new exports.Buffer(packet)
          mesh.receive(packet, pipe);
        }
      });

      if (pipe.sock) pipe.sock.end();
      // track this sock and 'pipe' it to/from our chunks
      pipe.sock = sock;
      sock.pipe(pipe.chunks);
      pipe.chunks.pipe(sock);
      sock.on('error', function(error) {}); // ignore errors, just handle end
      sock.on('end', function() {
        //console.log("SOCKET END")
        pipe.emit('down', pipe)
        delete pipe.sock;
      })
    }
    pipe.onSend = function(packet, link, cb) {
      cb = cb || () => {}
      // must create a connecting socket if none
      //console.log("sock?", !!pipe.sock, path)
      path.host = path.ip;
      if (!pipe.sock || pipe.sock.destroyed)
        pipe.use(net.connect(path, function() {
          if (!(packet instanceof Buffer))
            packet = new Buffer(packet);
          pipe.chunks.send(packet)
          cb()
        })); else {
        pipe.chunks.send(packet);
        cb();
      }
    }
    cbPipe(pipe);
  };

  // return our current addressible paths
  tp.paths = function() {
    var ifaces = os.networkInterfaces()
    var address = tp.server.address();
    var local = '127.0.0.1';
    var best = mesh.public.ipv4; // prefer that if any set
    for (var dev in ifaces) {
      ifaces[dev].forEach(function(details) {
        if (details.family != 'IPv4') return;
        if (details.internal) {
          local = details.address;
          return;
        }
        if (!best)
          best = details.address;
      });
    }
    best = tp.nat || best || local;
    return [{
      type: 'nix-domain',
      path: base_dir + mesh.hashname
    }];
  };

  // enable discovery mode, broadcast this packet
  tp.discover = function(opts, cbDisco){
    //console.log("nix domain discover")
    var meshes = fs.readdirSync(base_dir).filter((hn) =>  hn != mesh.hashname)

    var json = {type:'hn',hn:mesh.keys};
    var buf = lob.encode({json:json});

    meshes.forEach((hn) => {
      //console.log("make pipe", hn)
      var socket = net.createConnection(base_dir + hn, () => {
        //console.log("socket up")
        tp.pipe(false, {type:'nix-domain', fd: socket._handle.fd}, function(pipe){
          //console.log("discovered pipe")
          pipe.use(socket)
          pipe.onSend(buf);
          return (cbDisco)? cbDisco() : undefined;
        });
      })

      socket.on('error', () => {})
    })
  }

  tp.server.listen( base_dir + mesh.hashname, function(err) {
    if (err) mesh.log.error('tcp4 listen error', err);
    // TODO start pmp and upnp w/ our port
    cbExt(undefined, tp);
  });



  
}