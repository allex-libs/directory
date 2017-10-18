function createFileApi(execlib){
  'use strict';
  try {
  var Node = require('allex_nodehelpersserverruntimelib')(execlib.lib),
    util = require('./util')(execlib);
  require('./parserregistryintroducer')(execlib);
  require('./datageneratorregistryintroducer')(execlib);

  return {
    DataBase: require('./dbcreator')(execlib, util, Node),
    util: util
  };
  } catch (e) {
    console.log(e.stack);
    console.log(e);
  }
}

module.exports = createFileApi;
