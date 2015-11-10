function parserRegistryIntroducer(execlib){
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    execSuite = execlib.execSuite,
    parserRegistry = execSuite.parserRegistry;
  if(parserRegistry){
    return;
  }
  execSuite.parserRegistry = new execSuite.RegistryBase();
}

module.exports = parserRegistryIntroducer;
