/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var Async, exports;
if (typeof require == "function") {
  Async = require("./Async.jsm").Async;
  exports = module.exports;
}
else {
  Component.utils.import("gre://content/modules/Async.jsm");
  exports = this;

  exports.EXPORTED_SYMBOLS = [
    "AsyncTest",
    "AsyncTestReporters"
  ];
}

function makeAsync(args, fn, context) {
  if (fn.length > args) {
    return fn;
  }
  else {
    return function() {
      var value;
      var next = arguments[args];
      try {
        value = fn.apply(context || this, arguments);
      } catch(e) {
        return next(e);
      }
      next(null, value);
    };
  }
}

function empty(aNext) {
  aNext();
}

function log(aMsg) {
  if (typeof process != "undefined") {
    return process.stdout.write(aMsg);
  }
  dump(aMsg);
}

function Suite(aTests) {
  this.tests = aTests;
  var def = exports.AsyncTestReporters[exports.AsyncTest.DEFAULT_REPORTER];
  this.reporter = exports.AsyncTestReporters[aTests[0].reporter] || def;
  this.name = aTests[0].suiteName;
  this.notify = aTests[0].notify;
  this.stats = {
    start: new Date(),
    tests: aTests.length,
    passes: 0,
    skipped: 0,
    failures: 0
  };
}

Suite.STATE_START   = 0x0001;
Suite.STATE_SKIPPED = 0x0002;
Suite.STATE_DONE    = 0x0004;
Suite.STATE_END     = 0x0008;

Suite.prototype = {
  run: function() {
    var self = this;
    self.report(Suite.STATE_START);

    Async.eachSeries(this.tests, function(test, next) {
      var context = test.context || self;
      var setUp = empty;
      if (test.setUp)
        setUp = makeAsync(0, test.setUp, context);
      
      var tearDownCalled = false;
      var tearDownInner = empty;
      if (test.tearDown)
        tearDownInner = makeAsync(0, test.tearDown, context);

      function tearDown(next) {
        tearDownCalled = true;
        tearDownInner.call(test.context, next);
      }

      var testFn = makeAsync(0, test.fn, context);

      var chain = test.skip
        ? [test.setUpSuite, test.tearDownSuite]
        : [test.setUpSuite, setUp, testFn, tearDown, test.tearDownSuite];

      Async.eachSeries(chain, function(fn, callback) {
        var called = false;

        // timeout to watch async processes running too long...
        var timeout = setTimeout(function() {
          called = true;
          callback("Source did not respond after " + test.timeout + "ms!");
        }, test.timeout);

        Async.setImmediate(function() {
          try {
            fn.call(context, function(err) {
              if (called)
                return;
              called = true;
              clearTimeout(timeout);
              callback(err);
            });
          }
          catch (ex) {
            if (called)
              return;
            called = true;
            clearTimeout(timeout);
            if (!tearDownCalled)
              tearDown(function() {});
            callback(ex);
          }
        });
      }, function(err) {
        test.err = err;
        test.passed = !err;
        self.report(Suite.STATE_DONE, test);
        next();
      });
    }, function() {
      self.report(Suite.STATE_END);
    });
  },

  report: function(aState, aTest) {
    aTest = aTest || this.tests[0];

    if (aState & Suite.STATE_DONE) {
      if (aTest.skip)
        this.stats.skipped++;
      else if (aTest.passed)
        this.stats.passes++;
      else
        this.stats.failures++;
    }
    else if (aState & Suite.STATE_END) {
      this.stats.duration = new Date() - this.stats.start;
      if (this.notify) {
        var title = this.name || "Tests finished!";
        var text = "Out of " + this.stats.tests + " " + pluralize(this.stats.tests) + ": " + 
                   this.stats.passes + " passed, " + 
                   this.stats.failures + " failed and " +
                   this.stats.skipped + " skipped.";
        try {
          Components.classes["@mozilla.org/alerts-service;1"]
                    .getService(Components.interfaces.nsIAlertsService)
                    .showAlertNotification(null, title, text, false, "", null);
        } catch(e) {
          // prevents runtime error on platforms that don't implement nsIAlertsService
        }
      }
    }

    this.reporter(aState, aTest, this);
  }
};

exports.AsyncTest = function(aSuite) {
  if (!aSuite)
    throw new Error("A suite is required!");
  if (!aSuite.tests)
    throw new Error("aSuite.tests is required!");

  var methods = Object.keys(aSuite.tests);

  var setUp = aSuite.tests.setUp || null;
  var tearDown = aSuite.tests.tearDown || null;

  var single;
  methods.forEach(function(name) {
    if (name.charAt(0) == ">")
      single = name;
  });
  if (single)
    methods = [single];

  var testNames = methods.filter(function(method) {
    return typeof aSuite.tests[method] == "function";
  });
  var count = testNames.length;
  var i = 1;
  var suite = new Suite(testNames.map(function(name) {
    var skip = name.charAt(0) === "!";
    return {
      suiteName: aSuite.name || aSuite.tests.name || "",
      reporter: aSuite.reporter,
      notify: !!aSuite.notify,
      name: name,
      setUp: setUp,
      tearDown: tearDown,
      context: aSuite.tests,
      timeout: aSuite.timeout || aSuite.tests.timeout || 3000,
      fn: aSuite.tests[name],
      count: count,
      setUpSuite: i - 1 == 0 && aSuite.setUp
        ? makeAsync(0, aSuite.setUp, aSuite)
        : empty,
      tearDownSuite: i == testNames.length && aSuite.tearDown
        ? makeAsync(0, aSuite.tearDown, aSuite)
        : empty,
      skip: skip,
      index: i++
    };
  }));
  
  if (aSuite.skipAutorun)
    return suite;
  return suite.run();
};

exports.AsyncTest.DEFAULT_REPORTER = "dot";

var Colors = {
  "pass": 90,
  "fail": 31,
  "bright pass": 92,
  "bright fail": 91,
  "bright yellow": 93,
  "skipped": 36,
  "suite": 0,
  "error title": 0,
  "error message": 31,
  "error stack": 90,
  "checkmark": 32,
  "fast": 90,
  "medium": 33,
  "slow": 31,
  "green": 32,
  "light": 90,
  "diff gutter": 90,
  "diff added": 42,
  "diff removed": 41
};

/**
 * Default symbol map.
 */

var Symbols = {
  ok: "✓",
  err: "✖",
  dot: "․"
};

/**
 * Color `str` with the given `type`,
 * allowing colors to be disabled,
 * as well as user-defined color
 * schemes.
 *
 * @param {String} type
 * @param {String} str
 * @return {String}
 * @api private
 */
function colorize(aType, aStr) {
  return "\u001b[" + Colors[aType] + "m" + aStr + "\u001b[0m";
}

var s = 1000;
var m = s * 60;
var h = m * 60;
var d = h * 24;

/**
 * Parse the given `str` and return milliseconds.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */
function parse(str) {
  var m = /^((?:\d+)?\.?\d+) *(ms|seconds?|s|minutes?|m|hours?|h|days?|d|years?|y)?$/i.exec(str);
  if (!m)
    return;
  var n = parseFloat(m[1]);
  var type = (m[2] || "ms").toLowerCase();
  switch (type) {
    case "years":
    case "year":
    case "y":
      return n * 31557600000;
    case "days":
    case "day":
    case "d":
      return n * 86400000;
    case "hours":
    case "hour":
    case "h":
      return n * 3600000;
    case "minutes":
    case "minute":
    case "m":
      return n * 60000;
    case "seconds":
    case "second":
    case "s":
      return n * 1000;
    case "ms":
      return n;
  }
}

/**
 * Format the given `ms`.
 *
 * @param {Number} ms
 * @return {String}
 * @api public
 */
function ms(ms) {
  if (typeof ms == "string")
    return parse(ms);

  if (ms == d)
    return Math.round(ms / d) + " day";
  if (ms > d)
    return Math.round(ms / d) + " days";
  if (ms == h)
    return Math.round(ms / h) + " hour";
  if (ms > h)
    return Math.round(ms / h) + " hours";
  if (ms == m)
    return Math.round(ms / m) + " minute";
  if (ms > m)
    return Math.round(ms / m) + " minutes";
  if (ms == s)
    return Math.round(ms / s) + " second";
  if (ms > s)
    return Math.round(ms / s) + " seconds";
  return ms + " ms";
}

function pluralize(n) {
  return 1 == n ? "test" : "tests";
}

function epilogue(aSuite) {
  var stats = aSuite.stats;

  log("\n");

  // failure
  if (stats.failures) {
    log(colorize("bright fail", "  " + Symbols.err) +
        colorize("fail", " " + stats.failures + " of " + 
                 stats.tests + " " + pluralize(stats.tests) + "failed") +
        colorize("light", ":\n")
    );

    list(aSuite.tests.filter(function(test) {
      return !test.passed;
    }));
    log("\n");
    return;
  }

  // pass
  log(colorize("bright pass", " ") +
      colorize("green", " " + stats.tests + " " + pluralize(stats.tests) + 
               " complete") +
      colorize("light", " (" + ms(stats.duration) + ")\n")
  );

  // skipped
  if (stats.skipped) {
    log(colorize("skipped", " ") +
        colorize("skipped", " " + stats.skipped + " " + 
                 pluralize(stats.skipped) + " skipped\n")
    );
  }

  log("\n");
}

/**
 * Outut the given `failures` as a list.
 *
 * @param {Array} failures
 * @api public
 */
function list(failures){
  log("\n");
  failures.forEach(function(test, i){
    // msg
    var err = test.err;
    var message = err.message || "";
    var stack = err.stack || message;
    var index = stack.indexOf(message) + message.length;
    var msg = stack.slice(0, index);

    // indent stack trace without msg
    stack = stack.slice(index ? index + 1 : index)
                 .replace(/^/gm, "  ");

    log(colorize("error title", "  " + (i + 1) + ") " + test.suiteName + ":\n") +
        colorize("error message", "     " + msg) +
        colorize("error stack", "\n" + stack + "\n\n")
    );
  });
}

exports.AsyncTestReporters = {
  "dot": function(aState, aTest, aSuite) {
    if (aState & Suite.STATE_START) {
      log("\n  ");
    } else if (aState & Suite.STATE_DONE) {
      if (aTest.skip)
        log(colorize("skipped", Symbols.dot));
      else if (aTest.passed)
        log(colorize("fast", Symbols.dot));
      else
        log(colorize("fail", Symbols.dot));
    } else if (aState & Suite.STATE_END) {
      log("\n");
      epilogue(aSuite);
    }
  },
  "tap": function(aState, aTest, aSuite) {
    if (aState & Suite.STATE_START) {
      log("1.." + aSuite.stats.tests + "\n");
    } else if (aState & Suite.STATE_DONE) {
      var title = aTest.name.replace(/#/g, "");
      if (aTest.skip) {
        log("ok " + aTest.index + " " + title + " # SKIP -\n");
      } else if (aTest.passed) {
        log("ok " + aTest.index + " " + title + "\n");
      } else {
        log("not ok " + aTest.index + " " + title + "\n");
        if (aTest.err && aTest.err.stack)
          log(aTest.err.stack.replace(/^/gm, "  "));
      }
    } else if (aState & Suite.STATE_END) {
      log("# tests " + aSuite.stats.tests + "\n" +
          "# pass " + aSuite.stats.passes + "\n" +
          "# fail " + aSuite.stats.failures + "\n");
    }
  },
  "progress": function() {},
  "spec": function() {},
  "list": function() {},
  "nyan": function() {}
};
