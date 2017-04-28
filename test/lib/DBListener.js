function DBListener (db) {
  this.db = db;
  this.listener = null;
}
DBListener.prototype.startListening = function () {
  this.listener = this.db.changed.attach(this.onDBChanged);
};
DBListener.prototype.stopListening = function () {
  if (this.listener) {
    this.listener.destroy();
  }
  this.listener = null;
};
DBListener.prototype.onDBChanged = function (name, originalfs, newfs) {
  if (originalfs) {
    if (newfs) {
      if (originalfs.size > newfs.size) {
        console.log('-', name, originalfs.size-newfs.size, '=>', newfs.size);
      }
      if (originalfs.size < newfs.size) {
        console.log('+', name, newfs.size-originalfs.size, '=>', newfs.size);
      }
      if (originalfs.size === newfs.size) {
        console.log('=', name, '=>', newfs.size);
      }
    } else {
      console.log('X', name);
    }
  } else {
    if (newfs) {
      console.log('!', name, newfs.size);
    }
  }
}

module.exports = DBListener;
