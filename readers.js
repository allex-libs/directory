function createReaders(execlib,FileOperation,util,Node) {
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    qlib = lib.qlib,
    JobBase = qlib.JobBase,
    fs = Node.Fs,
    Path = Node.Path;

  function parserRegistry () {
    return execlib.execSuite.additionalRegistries.get('parsers');
  }

  function FileReader(name, path, defer) {
    FileOperation.call(this, name, path, defer);
  }
  lib.inherit(FileReader,FileOperation);
  FileReader.prototype.exclusive = false;

  FileReader.prototype.read = function (startfrom, quantityorbuffer, defer) {
    var size, buffer;
    if(quantityorbuffer instanceof Buffer){
      buffer = quantityorbuffer;
      size = buffer.length;
    }
    if ('number' === typeof quantityorbuffer) {
      size = quantityorbuffer;
      buffer = Buffer.allocUnsafe(size);
    }
    if(!buffer){
      return this.readWhole(startfrom, defer);
    }
    defer = defer || q.defer();
    if(!('number' === typeof startfrom || startfrom instanceof Number)) {
      startfrom = null;
    }
    //console.log('reading',size,'bytes for buffer of size', buffer.length);
    fs.read(this.fh, buffer, 0, size, startfrom, this._onBufferRead.bind(this, defer));
    return defer.promise;
  };
  FileReader.prototype._onBufferRead = function (defer, err, bytesread, buffer) {
    if (err) {
      defer.reject(err);
      this.reject(err);
      return;
    }
    if (bytesread !== buffer.length) {
      defer.notify(buffer.slice(0, bytesread));
    } else {
      defer.notify(buffer);
    }
    defer.resolve(bytesread);
  };

  FileReader.prototype.readWhole = function (startfrom, defer) {
    defer = defer || q.defer();
    this.size().done(this.onSizeForReadWhole.bind(this, startfrom, defer));
    return defer.promise;
  };
  FileReader.prototype.onSizeForReadWhole = function (startfrom, defer, size) { 
    if(!this.openDefer){
      defer.reject(new lib.Error('ALREADY_CLOSED','File is already closed'));
      return;
    }
    this.openDefer.promise.then(this.onOpenWithSizeForReadWhole.bind(this, startfrom, defer, size));
    this.open();
  };
  FileReader.prototype.onOpenWithSizeForReadWhole = function (startfrom, defer, size) {
    startfrom = startfrom || 0;
    this.read(startfrom, size-startfrom, defer);
  };

  FileReader.prototype.readInFixedChunks = function (recordsize, processfn) { 
    this.size().done(this.onSizeForFixedChunks.bind(this, recordsize, processfn));
  };
  FileReader.prototype.onSizeForFixedChunks = function (recordsize, processfn, size) {
    //console.log('onSizeForFixedChunks', size, recordsize);
    if ((size - headersize - footersize) % recordsize) {
      this.reject(new lib.Error('RECORD_SIZE_MISMATCH',this.name+' is of size '+size+' record of size '+recordsize+' cannot fit'));
      return;
    }
    this.openDefer.promise.then(this.readChunk.bind(this, Buffer.allocUnsafe(recordsize), processfn));
    this.open();
  };
  FileReader.prototype.readChunk = function (buffer, processfn) {
    fs.read(this.fh, buffer, 0, buffer.length, null, this.onChunkRead.bind(this, processfn));
  };
  FileReader.prototype.onChunkRead = function (processfn, err, bytesread, buffer) {
    var processresult;
    if (bytesread === buffer.length) {
      processresult = processfn(buffer);
      //attempt to support possible async parsing; for now the parsing is synchronous
      if (processresult && 'function' === typeof processresult.then) {
        processresult.then(this.readChunk.bind(this, buffer, processfn));
      } else {
        this.readChunk(buffer,processfn);
      }
    } else {
      processfn();
    }
  };
  FileReader.prototype.openMode = 'r';

  function FileTransmitter(name, path, options, defer) {
    FileReader.call(this, name, path, defer);
    this.options = options;
    this.buffer = null;
  }
  lib.inherit(FileTransmitter,FileReader);
  FileTransmitter.prototype.destroy = function () {
    this.buffer = null;
    this.options = null;
    FileReader.prototype.destroy.call(this);
  };
  FileTransmitter.prototype.go = function () {
    this.result = 0;
    this.size().then(
      this.onSizeForTransmit.bind(this)
    );
  };
  FileTransmitter.prototype.onSizeForTransmit = function () {
    if (!this.openDefer) {
      return;
    }
    this.openDefer.promise.then(
      this.step.bind(this)
    );
    this.open();
  }
  FileTransmitter.prototype.step = function () {
    if (!(this.originalFS && this.originalFS.size)) {
      return;
    }
    var offset = (this.options.start||0)+this.result,
      size;
    if (this.options.quantity) {
     size = Math.min(this.options.quantity-this.result, 0xffb0);
    } else {
     size = Math.min(this.originalFS.size-offset, 0xffb0);
    }
    if (size < 1) {
      this.destroy();
      return;
    }
    //console.log('size', this.originalFS.size, 'read from', offset, 'to read', size, 'with options', this.options);
    this.read(offset, size).then(
      //this.optionallyStep.bind(this),
      this.step.bind(this),
      this.reject.bind(this),
      this.onChunk.bind(this)
    );
  };
  /*
  FileTransmitter.prototype.optionallyStep = function () {
    if (!this.options.stepping) {
      this.step();
    }
  };
  */
  FileTransmitter.prototype.onChunk = function (chunk) {
    this.result += chunk.length;
    this.notify(chunk);
  };

  function ParsedFileReader(name, path, options, defer) {
    FileReader.call(this, name, path, defer);
    this.options = options;
  }
  lib.inherit(ParsedFileReader,FileReader);
  ParsedFileReader.prototype.destroy = function () {
    this.options = null;
    FileReader.prototype.destroy.call(this);
  };
  ParsedFileReader.prototype.go = function () {
    var metareader, rd;
    if(this.active){
      return;
    }
    this.active = true;
    if (this.options.parserinstance) {
      this.onParser(this.options.parserinstance);
    } else {
      if(this.options.parsermodulename === '*'){
        console.log(this, 'should find parser');
        rd = q.defer();
        metareader = readerFactory(Path.join('.meta', this.name), Path.join(Path.dirname(this.path), '.meta', this.name), {parsermodulename: 'allex_jsonparser'}, rd);
        rd.promise.done(
          this.onMeta.bind(this),
          this.reject.bind(this)
        );
        metareader.go();
      }else{
        parserRegistry().spawn(this.options.parsermodulename, this.options.propertyhash).done(
          this.onParser.bind(this),
          this.reject.bind(this)
        );
      }
    }
  };
  ParsedFileReader.prototype.onParser = function (parser) {
    if(lib.isFunction(parser.tryRecognizeNoDataFile)) {
      console.log('will try to recognize no data file', this.path);
      parser.tryRecognizeNoDataFile(this.path).then(
        this.onFileRecognizedAsNoDataFile.bind(this, parser),
        this.handleParser.bind(this, parser)
      );
      return;
    }
    this.handleParser(parser);
  };
  ParsedFileReader.prototype.onFileRecognizedAsNoDataFile = function (parser, isanodata) {
    if (isanodata) {
      parser.destroy();
      this.close();
      return;
    }
    this.handleParser(parser);
  };
  ParsedFileReader.prototype.handleParser = function (parser) {
    if(lib.defined(parser.recordDelimiter)){
      var delim = parser.recordDelimiter, tord = typeof delim, start, quantity;
      if ('number' === tord) {
        if (!(this.options && this.options.raw)) {
          this.result = 0;
          this.size().done(this.onSizeForParser.bind(this, parser));
        } else {
          parser.destroy(); //parser used only to read recordDelimiter
          start = this.options.hasOwnProperty('startfrom') ? this.options.startfrom * delim : null;
          quantity = this.options.hasOwnProperty('quantity') ? this.options.quantity * delim : null;
          this.openDefer.promise.then(this.onOpenForRawRead.bind(this, start, quantity));
          this.open();
        }
      }
      if (Buffer.isBuffer(parser.recordDelimiter)) {
        //console.log('time for readVariableLengthRecords', parser.recordDelimiter);
        this.openDefer.promise.done(this.readVariableLengthRecords.bind(this, parser, {offset:0}));
        this.open();
      }
    }else{
      this.readWhole().done(
        this.onWholeReadDone.bind(this, parser),
        this.reject.bind(this),
        this.onWholeReadData.bind(this, parser)
      );
    }
  };
  ParsedFileReader.prototype.onSizeForParser = function (parser, size) {
    var hrfr = new HRFReader(this, size, parser);
    hrfr.defer.promise.done(
      this.destroy.bind(this),
      this.onParserRejected.bind(this)
    );
    hrfr.go();
  };
  ParsedFileReader.prototype.onOpenForRawRead = function (start, quantity) {
    //console.log(this.name, 'onOpenForRawRead', start, quantity);
    this.read(start, quantity).done(
      this.onRawReadDone.bind(this),
      this.onParserRejected.bind(this),
      this.onParsedRecord.bind(this)
    );
  };
  ParsedFileReader.prototype.onParserRejected = function (reason) {
    if (reason && reason.code==='NO_DATA_FILE') {
      this.result = 0;
      this.close();
      return;
    }
    this.reject(reason);
  };
  ParsedFileReader.prototype.onParsedRecord = function (record) {
    if (lib.isVal(record)) {
      this.notify(record);
    }
  };
  ParsedFileReader.prototype.onWholeReadDone = function (parser, bytesread) {
    parser.destroy();
    this.close();
  };
  ParsedFileReader.prototype.onRawReadDone = function (bytesread) {
    this.result = bytesread;
    this.close();
  };
  ParsedFileReader.prototype.onWholeReadData = function (parser, buff) {
    try {
      this.result = parser.fileToData(buff);
    } catch(e) {
      this.reject(e);
    }
  };
  ParsedFileReader.prototype.readVariableLengthRecords = function (parser, offsetobj) {
    var buff = Buffer.allocUnsafe(1050);
    //console.log('reading with offset', offsetobj.offset);
    this.read(offsetobj.offset, buff).done(
      this.onBufferReadForVariableLengthRecord.bind(this, parser, buff, offsetobj)
     );
  };
  ParsedFileReader.prototype.onBufferReadForVariableLengthRecord = function (parser, buff, offsetobj, bytesread) {
    //console.log('csv bytes read', bytesread);
    var fr, records;
    if (!bytesread) {
      fr = parser.finalize();
      if (fr) {
        if (lib.isArray(fr)) {
          fr.forEach(this.notify.bind(this));
        } else {
          this.notify(fr);
        }
      }
      parser.destroy();
      this.result = offsetobj.offset;
      this.close();
      return;
    }
    buff = buff.length === bytesread ? buff : buff.slice(0, bytesread);
    try {
      records = parser.fileToData(buff);
      //console.log('records', records);
      //console.log(records.length, 'records');
      records.forEach(this.onParsedRecord.bind(this));
      offsetobj.offset+=bytesread;
      this.readVariableLengthRecords(parser, offsetobj);
    } catch (e) {
      this.onParserRejected(e);
    }
  };
  ParsedFileReader.prototype.onMeta = function (metainfo) {
    if (!metainfo) {
      this.reject(new lib.Error('NO_META_INFO', this.path+' has no corresponding .meta information'));
      return;
    }
    if (!metainfo.parserinfo) {
      this.reject(new lib.Error('NO_META_INFO', this.path+' has no corresponding parserinfo in .meta information'));
      return;
    }
    parserRegistry().spawn(metainfo.parserinfo.modulename, metainfo.parserinfo.propertyhash).done(
      this.onParser.bind(this),
      this.reject.bind(this)
    );
  };

  function HRFReader(filereader, filesize, parser) {
    //console.log('new HRFReader', filesize);
    JobBase.call(this);
    this.reader = filereader;
    this.parser = parser;
    this.filesize = filesize;
    this.header = parser.headerLength ? Buffer.allocUnsafe(parser.headerLength) : null;
    this.record = parser.recordDelimiter ? Buffer.allocUnsafe(parser.recordDelimiter) : null;
    this.footer = parser.footerLength ? Buffer.allocUnsafe(parser.footerLength) : null;
    this.recordstoread = ~~((this.filesize - this.headerLength() - this.footerLength()) / this.parser.recordDelimiter);
    //console.log(this.reader.name, 'recordstoread', this.recordstoread);
  }
  lib.inherit(HRFReader, JobBase);
  HRFReader.prototype.destroy = function () {
    if (this.parser) {
      this.parser.destroy();
    }
    this.recordstoread = null;
    this.footer = null;
    this.record = null;
    this.header = null;
    this.filesize = null;
    this.parser = null;
    this.reader = null;
    JobBase.prototype.destroy.call(this);
  };
  HRFReader.prototype.go = function () {
    var d = this.defer;
    this.proc();
    return d;
  };
  HRFReader.prototype.proc = function () {
    if (!this.sizesOK()) {
      console.error(this.reader.name+' is of size '+this.filesize+' record of size '+this.parser.recordDelimiter+' cannot fit');
      this.reject(new lib.Error('RECORD_SIZE_MISMATCH',this.name+' is of size '+this.size+' record of size '+this.parser.recordDelimiter+' cannot fit'));
      return;
    }
    this.reader.openDefer.promise.done(
      this.read.bind(this),
      this.reject.bind(this)
    );
    this.reader.open();
  }
  HRFReader.prototype.headerLength = function () {
    return this.parser.headerLength || 0;
  };
  HRFReader.prototype.footerLength = function () {
    return this.parser.footerLength || 0;
  };
  HRFReader.prototype.sizesOK = function () {
    return ((this.filesize - (this.headerLength()) - (this.footerLength())) % this.parser.recordDelimiter) === 0;
  };
  HRFReader.prototype.read = function () {
    var buff;
    if (!(this.reader && this.reader.fh)) {
      this.destroy();
      return;
    }
    if (this.header) {
      buff = this.header;
    } else if (this.record){
      buff = this.record;
    } else if (this.footer){
      buff = this.footer;
    }
    if (!buff) {
      this.destroy();
    } else {
      fs.read(this.reader.fh, buff, 0, buff.length, null, this.onRead.bind(this));
    }
  };
  HRFReader.prototype.onRead = function (err, bytesread, buffer) {
    //console.log('onRead', bytesread);
    if (buffer === this.header) {
      this.header = null;
      if (lib.isFunction(this.parser.onHeader)) {
        this.parser.onHeader(buffer);
      }
      //set this.record to Buffer.allocUnsafe(this.parser.recordDelimiter)
    } else if (buffer === this.record) {
      this.recordstoread --;
      if (this.recordstoread < 1) {
        this.record = null;
      }
      this.onRecord(buffer);
      if (!this.record) {
        this.finalize();
      }
    } else if (buffer === this.footer) {
      this.footer = null;
      if (lib.isFunction(this.parser.onFooter)) {
        this.parser.onFooter(buffer);
      }
    }
    this.read();
  };
  HRFReader.prototype.onRecord = function (record) {
    var rec;
    //console.log('onRecord', record);
    if (!record) {
      this.finalize();
      this.reader.close();
      this.destroy();
      return;
    }
    try {
      rec = this.parser.fileToData(record);
      if(lib.defined(rec)){
        this.reader.result++;
        this.reader.notify(rec);
      }
    } catch (e) {
      //console.log('ERROR in parsing record',record,':',e);
      this.reader.onParserRejected(e);
    }
  };
  HRFReader.prototype.finalize = function () {
    var rec;
    if (!this.parser) {
      return;
    }
    rec = this.parser.finalize();
    if (lib.defined(rec)) {
      if (lib.isArray(rec)) {
        rec.forEach(this.onRec.bind(this));
      } else {
        this.onRec(rec);
      }
    }
  };
  HRFReader.prototype.onRec = function (rec) {
    this.reader.result++;
    this.reader.notify(rec);
  };

  /*
   * options: {
   *   filecontents: { //options
   *     parsermodulename: '*' or a real parser modulename,
   *     parsers: {
   *       modulename: modulepropertyhash for spawning
   *     }
   *   },
   *   filestats: ['filebasename', 'filename', 'fileext', 'filetype', 'created', 'lastmodified'],
   *   metastats: [stringorfetcher],
   *   files: ['filename1', ..., 'filenameN'], //whitelist
   *   filetypes: ['f', 'd'], //whitelist
   * }
   */
  function DirReader(name, path, options, defer) {
    FileReader.call(this, name, path, defer);
    this.filecount = 0;
    this.options = options;
    this.parserInfo = {
      waiting: false,
      instance: null
    };
    /*
    if (this.options && this.options.filecontents) {
      if (this.options.filecontents.parsermodulename) {
        if (this.options.filecontents.parsermodulename !== '*') {
          parserRegistry().spawn(this.options.filecontents.parsermodulename, this.options.filecontents.propertyhash).done(
            this.onParserInstantiated.bind(this),
            this.reject.bind(this)
          );
        }
      }
    }
    */
  }
  lib.inherit(DirReader, FileReader);
  DirReader.prototype.destroy = function () {
    this.parserInfo = null;
    this.options = null;
    this.filecount = null;
    FileReader.prototype.destroy.call(this);
  };
  DirReader.prototype.go = function () {
    //console.log('going for', this.path, 'with current parserInfo', this.parserInfo, 'and options', this.options);
    /*
    if(this.options.needparsing && this.options.filecontents && this.options.filecontents.parsermodulename !== '*') {
      if (!this.parserInfo.instance) {
        this.parserInfo.waiting = true;
        return;
      } else {
        this.parserInfo.waiting = false;
      }
    }
    */
    this.type().then(
      this.onType.bind(this)
    );
  };
  DirReader.prototype.onParserInstantiated = function (parser) {
    //console.log('parser instantiated', parser, 'current parserInfo', this.parserInfo);
    this.parserInfo.instance = parser;
    if (this.parserInfo.waiting) {
      this.go();
    }
  };
  DirReader.prototype.onType = function(type){
    if (type !== 'd') {
      if (!type && this.options.acceptnonexisting) {
        console.log(this.options);
        this.result = 0;
        this.destroy();
        return;
      }
      this.reject(new lib.Error('WRONG_FILE_TYPE',this.name+' is not a directory'));
      return;
    }
    fs.readdir(this.path, this.onListing.bind(this));
  };
  DirReader.prototype.onListing = function (err, list) {
    if (err) {
      this.reject(err);
    } else {
      this.result = 0;
      if (list.length) {
        this.filecount = list.length;
        this.processFileList(list);
      } else {
        this.destroy();
      }
    }
  };
  DirReader.prototype.processFileList = function (filelist) {
    var filename;
    if (filelist.length) {
      filename = filelist.pop();
      //console.log('processFileName', filename, filelist, 'left');
      this.processFileName(filename).done(
        this.processSuccess.bind(this,filelist,filename),
        this.reject.bind(this)
      );
    } else {
      this.destroy();
    }
  };
  DirReader.prototype.processSuccess = function (filelist, filename, result) {
    if (result) {
      this.oneDone();
    } else {
      this.oneFailed();
    }
    this.processFileList(filelist);
  };
  DirReader.prototype.checkDone = function () {
    if(this.filecount===this.result){
      //console.log('DirReader destroying because', this.filecount, '===', this.result);
      this.destroy();
    };
  };
  DirReader.prototype.oneDone = function () {
    //console.log(this.name,'oneDone');
    this.result ++;
    //console.log('this.result is now', this.result);
    this.checkDone();
  };
  DirReader.prototype.oneFailed = function () {
    //console.log(this.name,'oneFailed');
    this.filecount --;
    //console.log('this.filecount is now', this.filecount);
    this.checkDone();
  };
  DirReader.prototype.processFileName = function (filename) {
    var d, rd, metareader;
    if (!this.options) {
      return q(false);
    }
    if (this.options.files && this.options.files.indexOf(filename) < 0) {
      return q(false);
    }
    d = q.defer();
    if (this.options && this.options.filecontents) {
      if (this.options.filecontents.parsermodulename) {
        if (this.options.filecontents.parsermodulename !== '*') {
          this.onMeta(d, filename, {
            parserinfo: {
              modulename: this.options.filecontents.parsermodulename,
              propertyhash: this.options.filecontents.propertyhash
            }
          });
          return d.promise;
        }
      }
    }
    //console.log(this.name, 'deciding wether to read .meta, this.parserInfo', this.parserInfo, 'this.options', this.options);
    if (this.needMeta()) {
      rd = q.defer();
      //console.log('metareader for', filename);
      metareader = readerFactory(Path.join('.meta', filename), Path.join(this.path, '.meta', filename), {parsermodulename: 'allex_jsonparser'}, rd);
      rd.promise.done(
        this.onMeta.bind(this,d,filename),
        d.resolve.bind(d, false)
      );
      metareader.go();
    } else {
      this.checkFStats(d, filename);
    }
    return d.promise;
  };
  DirReader.prototype.needParsing = function () {
    return this.options &&
      this.options.needparsing && 
      this.options.filecontents && 
      (
        this.options.filecontents.parsermodulename ||
        this.options.filecontents.parsers
      );
  };
  DirReader.prototype.needMeta = function () {
    //console.log('needMeta?', this.options);
    return this.options.metastats || this.needParsing();
  };
  function modulefinder(findobj, moduleitem) {
    if(findobj.modulename === moduleitem.modulename){
      findobj.found = moduleitem;
      return true;
    }
  }
  function fillMetaInfo(metainfo, metaresult, metaname){
    console.log('fillMetaInfo', metainfo);
    if (lib.isString(metaname)) {
      metaresult[metaname] = metainfo[metaname];
    } else {
      metaresult[metaname.dest] = lib.readPropertyFromDotDelimitedString(metainfo, metaname.src);
    }
  }
  DirReader.prototype.onMeta = function (defer, filename, meta) {
    //console.log(this.name, 'onMeta', filename, meta, require('util').inspect(this.options, {depth:null}));
    var parserfound, metainfo;
    if (!meta) {
      defer.resolve(false);
      return;
    }
    if (!this.options) {
      defer.resolve(false);
      return;
    }
    if (this.options.filecontents && this.options.filecontents.parsers) {
      //console.log('looking for', meta.parserinfo.modulename, 'in', this.options.filecontents.parsers);
      parserfound = this.options.filecontents.parsers[meta.parserinfo.modulename];
      //console.log('found', parserfound);
      if (!parserfound) {
        defer.resolve(false);
        return;
      }
      //console.log('found', parserfound);
      meta.parserinfo.propertyhash = lib.extend({}, meta.parserinfo.propertyhash, parserfound.propertyhash);
    }
    metainfo = {};
    if (this.options.metastats) {
      this.options.metastats.forEach(fillMetaInfo.bind(null, meta, metainfo));
      this.options.metainfo = metainfo;
    }
    if (this.needParsing()) {
      if (!meta.parserinfo) {
        defer.resolve(false);
        return;
      }
      //console.log(filename, 'meta.parserinfo', meta.parserinfo, 'this.options.filecontents', this.options.filecontents);
      parserRegistry().spawn(meta.parserinfo.modulename, meta.parserinfo.propertyhash).done(
        this.onMetaParser.bind(this, defer, filename),
        defer.resolve.bind(defer,false)
      );
    } else {
      this.checkFStats(defer, filename);
    }
  };
  DirReader.prototype.onMetaParser = function (defer, filename, parser) {
    if (!this.parserInfo) {
      return;
    }
    this.parserInfo.instance = parser;
    this.checkFStats(defer, filename);
  };
  DirReader.prototype.checkFStats = function (defer, filename) {
    if (this.needsFStats()) {
      fs.lstat(Path.join(this.path,filename), this.onFileStats.bind(this,defer,filename));
    } else {
      this.reportFile(filename, {defer:defer});
    }
  };
  DirReader.prototype.needsFStats = function () {
    return this.options ? this.options.filestats || this.options.filetypes : false;
  };
  DirReader.prototype.reportFile = function (filename, reportobj) {
    //console.log('reportFile', filename, 'this.parserInfo', this.parserInfo, '=>', reportobj);
    if (!this.options) {
      reportobj.defer.resolve(false);
      return;
    }
    if (this.options.needparsing) {
      var d = q.defer(),
        parser = readerFactory(filename, Path.join(this.path,filename), {parserinstance:this.parserInfo.instance}, d);
      d.promise.done(
        //reportobj.defer.resolve.bind(reportobj.defer,true),
        this.onParsedFile.bind(this, reportobj),
        this.reject.bind(this),
        this.onParsedRecord.bind(this, reportobj.data || {})
      );
      parser.go();
    } else {
      var data = lib.extend(reportobj.data, this.options.metainfo);
      //console.log(filename, '=>', data, this.options);
      this.notify(data || filename);
      reportobj.defer.resolve(true);
    }
  };
  DirReader.prototype.onParsedFile = function (reportobj) {
    if (this.parserInfo && this.parserInfo.instance) {
      this.parserInfo.instance.destroy();
      this.parserInfo.instance = null;
    }
    reportobj.defer.resolve(true);
  };
  DirReader.prototype.onParsedRecord = function (statsobj, parsedrecord) {
    //console.log('notifying', parsedrecord);
    if (!this.parserInfo) {
      return;
    }
    lib.traverse(statsobj,function(statsitem, statsname){
      parsedrecord[statsname] = statsitem;
    });
    lib.extend(parsedrecord, this.options.metainfo);
    this.notify(parsedrecord);
    parsedrecord = null;
  };
  DirReader.prototype.onFileStats = function (defer, filename, err, fstats, stats) {
    stats = stats || {};
    if (this.options.filetypes) {
      if (lib.isArray(this.options.filetypes) && this.options.filetypes.indexOf(util.typeFromStats(fstats))<0) {
        defer.resolve(false);
        return;
      }
    }
    this.options.filestats.forEach(this.populateStats.bind(this,filename,fstats,stats));
    this.reportFile(filename,{defer: defer, data: stats});
  };
  DirReader.prototype.populateStats = function (filename, fstats, stats, statsinfo) {
    var statskey, statsdest, mn, m;
    if (lib.isString(statsinfo)) {
      statskey = statsdest = statsinfo;
    } else {
      statskey = statsinfo.src;
      statsdest = statsinfo.dest;
    }
    if (!statskey) {
      console.error('statsinfo entry', statsinfo, 'resulted in no statskey');
      return;
    }
    mn = 'extract_'+statskey;
    m = this[mn];
    if ('function' === typeof m){
      stats[statsdest] = m.call(this, filename, fstats);
    }/* else {
      console.log('Method',mn,'does not exist to populate',statskey,'of filestats');
    }*/
  };
  DirReader.prototype.extract_filename = function (filename, fstats) {
    return filename;
  };
  DirReader.prototype.extract_filebasename = function (filename, fstats) {
    return Path.basename(filename,Path.extname(filename));
  };
  DirReader.prototype.extract_fileext = function (filename, fstats) {
    var ret = Path.extname(filename);
    return ret.charAt(0)==='.' ? ret.substring(1) : ret;
  };
  DirReader.prototype.extract_filetype = function (filename, fstats) {
    return util.typeFromStats(fstats);
  };
  DirReader.prototype.extract_created = function (filename, fstats) {
    return fstats.birthtime;
  };
  DirReader.prototype.extract_lastmodified = function (filename, fstats) {
    return fstats.mtime;
  };
  DirReader.prototype.extract_filesize = function (filename, fstats) {
    return fstats.size;
  };


  function readerFactory(name, path, options, defer) {
    if(options.parsermodulename || options.parserinstance){
      return new ParsedFileReader(name, path, options, defer);
    }
    if(options.traverse){
      return new DirReader(name, path, options, defer);
    }
    return new FileTransmitter(name, path, options, defer);
  }

  return readerFactory;
}

module.exports = createReaders;
