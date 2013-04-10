var AsyncTest = require("../lib/AsyncTest.jsm");
var Assert = require("assert");

AsyncTest.AsyncTest([
{
  name: "Minimal Test",
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
},

{
  name: "Test setUpSuite vs. setUp",
  reporter: "tap",
  setUpSuite: function() {
    if (!this.x)
      this.x = 0;
    this.x++;
  },
  setUp: function() {
    if (!this.y)
      this.y = 0;
    this.y++;
  },
  tests: {
    "it should have invoked setUp once": function(next) {
      Assert.equal(this.x, 1);
      Assert.equal(this.y, 1);
      next();
    },
    "it should have invoked setUp twice ": function(next) {
      Assert.equal(this.x, 1);
      Assert.equal(this.y, 2);
      next();
    }
  }
},

{
  name: "Test tearDownSuite vs. tearDown",
  reporter: "tap",
  tearDownSuite: function() {
    if (!this.x)
      this.x = 0;
    this.x++;
  },
  tearDown: function() {
    if (!this.y)
      this.y = 0;
    this.y++;
  },
  tests: {
    "it should have invoked tearDown once": function(next) {
      Assert.ok(!this.x);
      Assert.ok(!this.y);
      next();
    },
    "it should have invoked tearDown twice ": function(next) {
      Assert.ok(!this.x);
      Assert.equal(this.y, 1);
      next();
    }
  }
}

]);
