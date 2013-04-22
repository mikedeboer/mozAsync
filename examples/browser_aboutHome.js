/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/
 */

XPCOMUtils.defineLazyModuleGetter(this, "Async",
  "resource://gre/modules/Async.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "AsyncTest",
  "resource://gre/modules/AsyncTest.jsm");
XPCOMUtils.defineLazyModuleGetter(this, "Promise",
  "resource://gre/modules/commonjs/sdk/core/promise.js");
XPCOMUtils.defineLazyModuleGetter(this, "AboutHomeUtils",
  "resource:///modules/AboutHomeUtils.jsm");

let gRightsVersion = Services.prefs.getIntPref("browser.rights.version");

function test() {

waitForExplicitFinish();
requestLongerTimeout(2);

/**
 * Cleans up snippets and ensures that by default we don't try to check for
 * remote snippets since that may cause network bustage or slowness.
 *
 * @param aTab
 *        The tab containing about:home.
 * @param aSetupFn
 *        The setup function to be run.
 * @return {Promise} resolved when the snippets are ready.  Gets the snippets map.
 */
function promiseSetupSnippetsMap(aTab, aSetupFn) {
  let deferred = Promise.defer();
  let cw = aTab.linkedBrowser.contentWindow.wrappedJSObject;
  info("Waiting for snippets map");
  cw.ensureSnippetsMapThen(function (aSnippetsMap) {
    info("Got snippets map: " +
         "{ last-update: " + aSnippetsMap.get("snippets-last-update") +
         ", cached-version: " + aSnippetsMap.get("snippets-cached-version") +
         " }");
    // Don't try to update.
    aSnippetsMap.set("snippets-last-update", Date.now());
    aSnippetsMap.set("snippets-cached-version", AboutHomeUtils.snippetsVersion);
    // Clear snippets.
    aSnippetsMap.delete("snippets");
    aSetupFn(aSnippetsMap);
    // Must be sure to continue after the page snippets map setup.
    executeSoon(function() deferred.resolve(aSnippetsMap));
  });
  return deferred.promise;
}

AsyncTest({
  name: "about:home test suite",
  setUp: function(aNext) {
    // Create a new tab and waits for a load event.
    let tab = this.tab = gBrowser.selectedTab = gBrowser.addTab("about:home");
    tab.linkedBrowser.addEventListener("DOMContentLoaded", function load(event) {
      if (event.originalTarget != tab.linkedBrowser.contentDocument ||
          event.target.location.href == "about:blank") {
        info("skipping spurious load event");
        return;
      }
      tab.linkedBrowser.removeEventListener("DOMContentLoaded", load, true);
      
      // Must wait for both the snippets map and the browser attributes, since
      // can't guess the order they will happen.
      // So, start listening now, but verify the promise is fulfilled only
      // after the snippets map setup.

      // Wait for the attributes being set by browser.js and overwrites snippetsURL
      // to ensure we won't try to hit the network and we can force xhr to throw.
      let docElt = tab.linkedBrowser.contentDocument.documentElement;
      //docElt.setAttribute("snippetsURL", "nonexistent://test");
      let observer = new MutationObserver(function (mutations) {
        for (let mutation of mutations) {
          info("Got attribute mutation: " + mutation.attributeName +
                                        " from " + mutation.oldValue); 
          if (mutation.attributeName == "snippetsURL" &&
              docElt.getAttribute("snippetsURL") != "nonexistent://test") {
            docElt.setAttribute("snippetsURL", "nonexistent://test");
          }

          // Now we just have to wait for the last attribute.
          if (mutation.attributeName == "searchEngineURL") {
            info("Remove attributes observer");
            observer.disconnect();
            // Must be sure to continue after the page mutation observer.
            executeSoon(aNext);
            break;
          }
        }
      });
      info("Add attributes observer");
      observer.observe(docElt, { attributes: true });
    }, true);
  },
  tearDown: function() {
    gBrowser.removeCurrentTab();
  },
  tearDownSuite: function() {
    // Ensure we don't pollute prefs for next tests.
    Services.prefs.clearUserPref("network.cookies.cookieBehavior");
    Services.prefs.clearUserPref("network.cookie.lifetimePolicy");
    Services.prefs.clearUserPref("browser.rights.override");
    Services.prefs.clearUserPref("browser.rights." + gRightsVersion + ".shown");

    finish();
  },
  tests: {
    "Check that clearing cookies does not clear storage": function(aNext) {
      promiseSetupSnippetsMap(this.tab, function() {
        Cc["@mozilla.org/observer-service;1"]
          .getService(Ci.nsIObserverService)
          .notifyObservers(null, "cookie-changed", "cleared");
      }).then(function(aSnippetsMap) {
        isnot(aSnippetsMap.get("snippets-last-update"), null,
              "snippets-last-update should have a value");
        aNext();
      });
    },
    "Check default snippets are shown": function() {
      let doc = gBrowser.selectedTab.linkedBrowser.contentDocument;
      let snippetsElt = doc.getElementById("snippets");
      ok(snippetsElt, "Found snippets element");
      is(snippetsElt.getElementsByTagName("span").length, 1,
         "A default snippet is present.");
    },
    "Check default snippets are shown if snippets are invalid xml": function(aNext) {
      let snippetsMap = yield promiseSetupSnippetsMap(this.tab, function(aSnippetsMap) {
        // This must be some incorrect xhtml code.
        aSnippetsMap.set("snippets", "<p><b></p></b>");
      }).then(function(aSnippetsMap) {
        let doc = gBrowser.selectedTab.linkedBrowser.contentDocument;

        let snippetsElt = doc.getElementById("snippets");
        ok(snippetsElt, "Found snippets element");
        is(snippetsElt.getElementsByTagName("span").length, 1,
           "A default snippet is present.");

        aSnippetsMap.delete("snippets");
        aNext();
      });
    },
    "Check that search engine logo has alt text": function() {
      let doc = gBrowser.selectedTab.linkedBrowser.contentDocument;

      let searchEngineLogoElt = doc.getElementById("searchEngineLogo");
      ok(searchEngineLogoElt, "Found search engine logo");

      let altText = searchEngineLogoElt.alt;
      ok(typeof altText == "string" && altText.length > 0,
         "Search engine logo's alt text is a nonempty string");

      isnot(altText, "undefined",
            "Search engine logo's alt text shouldn't be the string 'undefined'");
    },
    "Check that performing a search fires a search event.": function(aNext) {
      let doc = gBrowser.contentDocument;

      doc.addEventListener("AboutHomeSearchEvent", function onSearch(e) {
        is(e.detail, doc.documentElement.getAttribute("searchEngineName"), "Detail is search engine name");

        gBrowser.stop();
        aNext();
      }, true, true);

      doc.getElementById("searchText").value = "it works";
      doc.getElementById("searchSubmit").click();
    },
    "Check that performing a search records to Firefox Health Report.": function(aNext) {
      try {
        let cm = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
        cm.getCategoryEntry("healthreport-js-provider-default", "SearchesProvider");
      } catch (ex) {
        // Health Report disabled, or no SearchesProvider.
        return aNext();
      }

      let doc = gBrowser.contentDocument;

      // We rely on the listener in browser.js being installed and fired before
      // this one. If this ever changes, we should add an executeSoon() or similar.
      doc.addEventListener("AboutHomeSearchEvent", function onSearch(e) {
        executeSoon(gBrowser.stop.bind(gBrowser));
        let reporter = Components.classes["@mozilla.org/datareporting/service;1"]
                                         .getService()
                                         .wrappedJSObject
                                         .healthReporter;
        ok(reporter, "Health Reporter instance available.");

        reporter.onInit().then(function onInit() {
          let provider = reporter.getProvider("org.mozilla.searches");
          ok(provider, "Searches provider is available.");

          let engineName = doc.documentElement.getAttribute("searchEngineName");
          let id = Services.search.getEngineByName(engineName).identifier;

          let m = provider.getMeasurement("counts", 2);
          m.getValues().then(function onValues(data) {
            let now = new Date();
            ok(data.days.hasDay(now), "Have data for today.");

            let day = data.days.getDay(now);
            let field = id + ".abouthome";
            ok(day.has(field), "Have data for about home on this engine.");

            // Note the search from the previous test.
            is(day.get(field), 2, "Have searches recorded.");

            aNext();
          });

        });
      }, true, true);

      doc.getElementById("searchText").value = "a search";
      doc.getElementById("searchSubmit").click();
    },
    "Check snippets map is cleared if cached version is old": function(aNext) {
      promiseSetupSnippetsMap(this.tab, function(aSnippetsMap) {
        aSnippetsMap.set("snippets", "test");
        aSnippetsMap.set("snippets-cached-version", 0);
      }).then(function(aSnippetsMap) {
        ok(!aSnippetsMap.has("snippets"), "snippets have been properly cleared");
        ok(!aSnippetsMap.has("snippets-cached-version"),
           "cached-version has been properly cleared");
        aNext();
      });
    },
    "Check cached snippets are shown if cached version is current": function(aNext) {
      promiseSetupSnippetsMap(this.tab, function(aSnippetsMap) {
        aSnippetsMap.set("snippets", "test");
      }).then(function(aSnippetsMap) {
        let doc = gBrowser.selectedTab.linkedBrowser.contentDocument;
  
        let snippetsElt = doc.getElementById("snippets");
        ok(snippetsElt, "Found snippets element");
        is(snippetsElt.innerHTML, "test", "Cached snippet is present.");
  
        is(aSnippetsMap.get("snippets"), "test", "snippets still cached");
        is(aSnippetsMap.get("snippets-cached-version"),
           AboutHomeUtils.snippetsVersion,
           "cached-version is correct");
        ok(aSnippetsMap.has("snippets-last-update"), "last-update still exists");
        aNext();
      });

    },
    "Check if the 'Know Your Rights default snippet is shown when 'browser.rights.override' pref is set": function() {
      Services.prefs.setBoolPref("browser.rights.override", false);

      let doc = gBrowser.selectedTab.linkedBrowser.contentDocument;
      let showRights = AboutHomeUtils.showKnowYourRights;

      ok(showRights, "AboutHomeUtils.showKnowYourRights should be TRUE");

      let snippetsElt = doc.getElementById("snippets");
      ok(snippetsElt, "Found snippets element");
      is(snippetsElt.getElementsByTagName("a")[0].href, "about:rights", "Snippet link is present.");

      Services.prefs.clearUserPref("browser.rights.override");
    },
    "Check if the 'Know Your Rights default snippet is NOT shown when 'browser.rights.override' pref is NOT set": function() {
      Services.prefs.setBoolPref("browser.rights.override", true);

      let doc = gBrowser.selectedTab.linkedBrowser.contentDocument;
      let rightsData = AboutHomeUtils.knowYourRightsData;
      
      ok(!rightsData, "AboutHomeUtils.knowYourRightsData should be FALSE");

      let snippetsElt = doc.getElementById("snippets");
      ok(snippetsElt, "Found snippets element");
      ok(snippetsElt.getElementsByTagName("a")[0].href != "about:rights", "Snippet link should not point to about:rights.");

      Services.prefs.clearUserPref("browser.rights.override");
    }
  }
});

} // test()
