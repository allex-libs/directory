var fs = require('fs'),
    Path = require('path'),
    mkdirp = require('mkdirp');

function createUtil(execlib){
  'use strict';
  var lib = execlib.lib;

  function surePath(path) {
    if (lib.isArray(path)) {
      return Path.join.apply(Path, path);
    }
    return path;
  }

  function satisfyPath(path){
    var p;
    path = surePath(path);
    p = Path.isAbsolute(path) ? path : Path.join(process.cwd(),path);
    mkdirp.sync(path);
  }
  function pathForFilename(path,filename){
    var ret = Path.join(surePath(path),filename);
    satisfyPath(Path.dirname(ret));
    return ret;
  }
  function typeFromStats(stats){
    if(stats.isFile()){
      return 'f';
    }
    if(stats.isDirectory()){
      return 'd';
    }
    if(stats.isBlockDevice()){
      return 'b';
    }
    if(stats.isCharacterDevice()){
      return 'c';
    }
    if(stats.isSymbolicLink()){
      return 'l';
    }
    if(stats.isSocket()){
      return 's';
    }
    if(stats.isFIFO()){
      return 'n'; //named pipe
    }
  }
  function fileType(filepath,defer){
    if(defer){
      fs.lstat(filepath,function(err,fstats){
        if(err){
          defer.resolve(0);
        }else{
          defer.resolve(typeFromStats(fstats));
        }
      });
    }else{
      try{
        var fstats = fs.lstatSync(filepath);
        return typeFromStats(fstats);
      }
      catch(e){
        return '';
      }
    }
  }
  function fileSize(filepath,defer){
    if(defer){
      fs.lstat(filepath,function(err,fstats){
        if(err){
          defer.resolve(0);
        }else{
          defer.resolve(fstats.size);
        }
        defer = null;
      });
    }else{
      try{
        var fstats = fs.lstatSync(filepath);
        return fstats.size;
      }
      catch(e){
        return 0;
      }
    }
  }

  function FStats(filepath,defer) {
    if(defer){
      fs.lstat(filepath,function(err,fstats){
        if(err){
          defer.resolve(null);
        }else{
          defer.resolve(fstats);
        }
        defer = null;
      });
    }else{
      try{
        var fstats = fs.lstatSync(filepath);
        return fstats;
      }
      catch(e){
        return null;
      }
    }
  }

  return {
    satisfyPath: satisfyPath,
    pathForFilename: pathForFilename,
    fileSize: fileSize,
    fileType: fileType,
    FStats: FStats,
    typeFromStats: typeFromStats
  };
}

module.exports = createUtil;
