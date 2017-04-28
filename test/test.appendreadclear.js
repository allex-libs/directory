var JobBase = qlib.JobBase,
  DBListener = require('./lib/DBListener');

function AppendReadClearJob (db, filename, appendcount) {
  JobBase.call(this);
  this.db = db;
  this.fileName = filename;
  this.appendCount = appendcount;
  this.expected = '';
}
lib.inherit(AppendReadClearJob, JobBase);
AppendReadClearJob.prototype.destroy = function () {
  this.expected = null;
  this.appendCount = null;
  this.fileName = null;
  this.db = null;
  JobBase.prototype.destroy.call(this);
}
AppendReadClearJob.prototype.go = function () {
  var promises;
  this.expected = '';
  promises = this.produceAppendPromises();
  promises.push(this.reader().then(this.checkAgainstExpected.bind(this)));
  promises.push(this.db.drop(this.fileName));
  return q.all(promises);
};
AppendReadClearJob.prototype.produceAppendPromises = function () {
  var ret = [], append, i;
  for (i=0; i<this.appendCount; i++) {
    append = Date.now()+'_'+('0000'+i).substr(-4)+'\n';
    this.expected += append;
    ret.push(this.lineWriter(append));
  }
  return ret;
};
AppendReadClearJob.prototype.lineWriter = function (line) {
  var d = q.defer();
  this.db.write(this.fileName, {append:true}, d).then(
    (writer) => {
      writer.write(line).then(writer.close.bind(writer));
      line = null;
    }
  );
  return d.promise;
};
AppendReadClearJob.prototype.checkAgainstExpected = function (read) {
  if (read !== this.expected) {
    this.reject(new lib.Error('NOT_AS_EXPECTED', read+'!=='+this.expected));
  } else {
    this.resolve(true);
  }
};
AppendReadClearJob.prototype.reader = function () {
  var d = q.defer(), retobj = {ret:''}, ret = retobj.ret;
  this.db.read(this.fileName, {}, d);
  d.promise.then(function () {
    d = null;
  }, function () {
    d = null;
  }, function (chunk) {
    retobj.ret += chunk.toString();
  });
  return d.promise.then(qlib.propertyreturner(retobj, 'ret'));
};

function runAppendReadClearJobs (db, filename, appendcount, times, defer) {
  var j;
  defer = defer || q.defer();
  if (times<1) {
    defer.resolve(true);
    return;
  }
  j = new AppendReadClearJob(db, filename, appendcount);
  j.defer.promise.then(
    runAppendReadClearJobs.bind(null, db, filename, appendcount, times-1, defer),
    defer.reject.bind(defer)
  );
  j.go();
  return defer.promise;
}

describe('Append-Read-Clear tests', function () {
  loadClientSide(['allex:directory:lib']);
  it ('Create a directory database', function () {
    return setGlobal('DB', new directorylib.DataBase('test.dir'));
  });
  it ('Append DB changed listener', function () {
    //DB.changed.attach(console.log.bind(console, 'db change'));
    setGlobal('dbListener', new DBListener(DB));
    dbListener.startListening();
  });
  it ('Append-Read-Clear cycle', function () {
    var j = new AppendReadClearJob(DB, 'test1.txt', 5), ret = j.defer.promise;
    j.go();
    return ret;
  });
  it ('5 Append-Read-Clear cycles one after each other', function () {
    return runAppendReadClearJobs(DB, 'test1.txt', 10, 5);
  });
  it ('2 parallel Append-Read-Clear cycles', function () {
    var j1 = new AppendReadClearJob(DB, 'test1.txt', 5),
      j2 = new AppendReadClearJob(DB, 'test1.txt', 15),
      ret = q.all([j1.defer.promise,j2.defer.promise]);
    j1.go();
    j2.go();
    return ret;
  });
  it ('Looong Append-Read-Clear cycle', function () {
    this.timeout(100000);
    dbListener.stopListening();
    var j = new AppendReadClearJob(DB, 'test1.txt', 1e5), ret = j.defer.promise;
    j.go();
    return ret;
  });
});
