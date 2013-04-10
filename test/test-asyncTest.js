var AsyncTest = require("../lib/AsyncTest.jsm");
var Assert = require("assert");

AsyncTest.AsyncTest({
  name: "Minimal Test",
  //reporter: "tap",
  notify: true,
  tests: {
    "it should execute this test": function(next) {
      Assert.equal(typeof next, "function", "'next' should be a callback function");
      next();
    },

    "! it should NOT execute this test": function(next) {
      Assert.ok(false, "BAM!");
      next();
    },

    "it should be aware of the correct context": function(next) {
      Assert.ok(this["it should execute this test"], "The function ought to be accessible");
      next();
    }
  }
});
