/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

Component.utils.import("gre://content/modules/Async.jsm");

this.EXPORTED_SYMBOLS = [
  "AsyncTest",
  "AsyncTestReporters"
];

var root = this;

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

function empty(next) {
  next();
}

function Suite(aTests) {
  this.tests = aTests;
  var def = root.AsyncTestReporters[root.AsyncTest.DEFAULT_REPORTER];
  this.reporter = root.AsyncTestReporters[aTests[0].reporter] || def;
  this.stats = {
    start: new Date(),
    tests: aTests.length,
    passes: 0,
    pending: 0,
    failures: 0,
    skipped: 0
  };
}

Suite.STATE_START   = 0x0001;
Suite.STATE_PENDING = 0x0002;
Suite.STATE_DONE    = 0x0004;
Suite.STATE_END     = 0x0008;

Suite.prototype = {
  run: function() {
    var self = this;
    self.report(Suite.STATE_START);

    Async.eachSeries(this.tests, function(test, next) {
      self.report(Suite.STATE_PENDING, test);

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
              callback(err, !err);
            });
          }
          catch (ex) {
            if (called)
              return;
            called = true;
            clearTimeout(timeout);
            if (!tearDownCalled)
              tearDown(function() {});
            callback(ex, false);
          }
        });
      }, function(err, passed) {
        test.err = err;
        test.passed = passed;
        self.report(Suite.STATE_DONE, test);
        next();
      });
    }, function() {
      self.report(Suite.STATE_END);
    });
  },

  report: function(aState, aTest) {
    aTest = aTest || this.tests[0];

    if (aState & Suite.STATE_PENDING) {
      this.stats.pending++;
    }
    else if (aState & Suite.STATE_DONE) {
      this.stats.pending--;
      if (aTest.passed)
        this.stats.passed++;
      else
        this.stats.failures++;
      if (aTest.skip)
        this.stats.skipped++;
    }
    else if (aState & Suite.STATE_END) {
      this.stats.duration = new Date() - this.stats.start;
    }
    
    this.reporter(aState, aTest, this);
  }
};

this.AsyncTest = function(aSuite) {
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
    return method.match(/^[>\!]?test/) && typeof(aSuite.tests[method]) == "function";
  });
  var count = testNames.length;
  var i = 1;
  var suite = new Suite(testNames.map(function(name) {
    let skip = name.charAt(0) === "!";
    return {
      suiteName: aSuite.name || aSuite.tests.name || "",
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

this.AsyncTest.DEFAULT_REPORTER = "dot";

var Colors = {
  "pass": 90,
  "fail": 31,
  "bright pass": 92,
  "bright fail": 91,
  "bright yellow": 93,
  "pending": 36,
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

var colorize = function(aType, aStr) {
  return "\u001b[" + Colors[aType] + "m" + aStr + "\u001b[0m";
};

function epilogue(aSuite) {
  var fmt, tests;
  var stats = aSuite.stats;

  dump("\n");

  function pluralize(n) {
    return 1 == n ? "test" : "tests";
  }

  // failure
  if (stats.failures) {
    dump(colorize("bright fail", "  " + Symbols.err) +
         colorize("fail", " " + stats.failures + " of " + 
                  stats.tests + " " + pluralize(stats.tests) + "failed") +
         colorize("light", ":\n")
    );

    list(aSuite.tests.filter(function(test) {
      return !test.passed;
    }));
    dump("\n");
    return;
  }

  // pass
  dump(colorize("bright pass", " ") +
       colorize("green", " " + stats.tests + " " + pluralize(stats.tests) + 
                " complete") +
       colorize("light", " (" + ms(stats.duration) + ")\n")
  );

  // pending
  if (stats.pending) {
    dump(colorize("pending", " ") +
         colorize("pending", " " + stats.pending + " " + 
                  pluralize(stats.pending) + " pending\n")
    );
  }

  dump("\n");
}

/**
 * Outut the given `failures` as a list.
 *
 * @param {Array} failures
 * @api public
 */
function list(failures){
  dump("\n");
  failures.forEach(function(test, i){
    // msg
    var err = test.err
    var message = err.message || "";
    var stack = err.stack || message;
    var index = stack.indexOf(message) + message.length;
    var msg = stack.slice(0, index);

    // indent stack trace without msg
    stack = stack.slice(index ? index + 1 : index)
                 .replace(/^/gm, "  ");

    dump(colorize("error title", "  " + (i + 1) + ") " + test.suiteName + ":\n") +
         colorize("error message", "     " + msg) +
         colorize("error stack", "\n" + stack + "\n\n")
    );
  });
};

this.AsyncTestReporters = {
  "dot": function(aState, aTest, aSuite) {
    if (aState & Suite.STATE_START) {
      dump("\n  ");
    }
    else if (aState & Suite.STATE_PENDING) {
      dump(colorize("pending", Symbols.dot));
    }
    else if (aState & Suite.STATE_DONE) {
      if (aTest.passed)
        dump(colorize("fast", Symbols.dot));
      else
        dump(colorize("fail", Symbols.dot));
    }
    else if (aState & Suite.STATE_END) {
      dump("\n");
      epilogue(aSuite);
    }
  },
  "tap": function() {},
  "progress": function() {},
  "spec": function() {},
  "list": function() {},
  "nyan": function() {}
};
