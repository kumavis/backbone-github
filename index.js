/**
 * Backbone sync adapter to use js-git as storage
 * Version 0.0.0
 *
 * https://github.com/digidem/Backbone.js-git
 * (c) 2014 Gregor MacLennan / Digital Democracy
 *
 * Backbone.js-git may be freely distributed under the MIT license
 */

var concurrentConnections = 10;

// Require Underscore, if we're on the server, and it's not already present.
var _ = require('underscore');

var Backbone = require('backbone');

var q = require('async').queue(syncWorker, concurrentConnections);

// Pause the queue until we have initialized the IndexedDb cache
q.pause();

var indexedDbCache = require('js-git/mixins/indexed-db');

indexedDbCache.init(function() {
    q.resume();
});

// cache for repo connections
var repos = {};

// inspired from https://github.com/Raynos/xtend
function extend() {
    var target = {};

    for (var i = 0; i < arguments.length; i++) {
        var source = arguments[i];

        if (typeof source !== 'object') {
            continue;
        }

        for (var name in source) {
            if (source[name] && target[name] && typeof source[name] === 'object' && typeof target[name] === 'object' && name !== 'db') {
                target[name] = extend(target[name] || {}, source[name]);
            } else {
                target[name] = source[name];
            }
        }
    }
    return target;
}

// This provides symbolic names for the octal modes used by git trees.
var modes = require('js-git/lib/modes');

var githubNameRe = /https:\/\/github\.com\/(.+?\/.+?)\//;
var githubRefRe = /https:\/\/github\.com\/.+?\/.+?\/tree\/(.+?)\//;

// backbone-github sync adapter
module.exports = function(defaults) {
    defaults = defaults || {};

    // ensure we have a github API token
    if (!defaults.githubToken) {
        throw new Error('A "githubToken" property must be specified');
    }

    return function adapter(method, model, options) {

        options = options || {};
        options = extend(defaults, model && model.github || {}, options);

        var githubName = _.result(model, 'url').match(githubNameRe);
        githubName = (githubName && githubName[1]) || options.user + "/" + options.repo;

        var repo = getRepo(githubName, options.githubToken);

        q.push({
            method: method,
            model: model,
            repo: repo,
            options: options
        }, function(err, data) {
            if (err) return options.error(err);
            return options.success(data);
        });
    };
};

function syncWorker(data, callback) {
    var model = data.model,
        repo = data.repo;

    var collection = model.collection || model;

    var branch = _.result(collection, 'url').match(githubRefRe);
    branch = (branch && branch[1]) || options.branch || 'master';

    // *TODO* no handling of tags yet
    var ref = 'refs/heads/' + branch;

    if (data.method === 'read') {
        if (!model.collection) {
            findAll();
        } else {
            find();
        }
        if (model.trigger) model.trigger('request', model, null, data.options);
    } else {
        callback('Only "read" supported at this stage');
    }

    function find() {
        var collectionId = _.result(collection, 'url').split('/').pop();
        var filename = model.id + '.json';
        getTree(collectionId, function(err, tree) {
            if (!tree[filename]) return callback('model not found');
            repo.loadAs("text", tree[filename].hash, function(err, json) {
                callback(err, JSON.parse(json));
            });
        });
    }

    function findAll() {
        var error,
            models = [],
            count = 0,
            collectionId = _.result(collection, 'url').split('/').pop();

        function onModelLoad(err, model) {
            if (err) {
                error = err;
                models.push(undefined);
            } else {
                models.push(model);
            }
            if (models.length + 1 === count) callback(error, models);
        }

        getTree(collectionId, function(err, tree) {
            var taskData;
            for (var entry in tree) {
                if (tree.hasOwnProperty(entry) && entry.match(/\.json$/) && tree[entry].mode === modes.file) {
                    count += 1;
                    taskData = _.extend({}, data, {
                        model: {
                            id: entry.replace('.json', ''),
                            collection: model
                        }
                    });
                    q.push(taskData, onModelLoad);
                }
            }
        });
    }

    function getTree(collectionId, callback) {
        repo.readRef(ref, loadTree);

        function loadTree(err, hash) {
            if (err) return callback(err);
            repo.loadAs('commit', hash, function(err, commit) {
                repo.loadAs('tree', commit.tree, function(err, tree) {
                    if (!tree[collectionId]) callback('Collection not found');
                    repo.loadAs('tree', tree[collectionId].hash, function(err, tree) {
                        callback(err, tree);
                    });
                });
            });
        }
    }
}

function getRepo(githubName, githubToken) {
    // return cached repo object if it exists
    if (repos[githubName]) return repos[githubName];

    var repo = {};

    // Mixin the main library using github to provide the following:
    // - repo.loadAs(type, hash) => value
    // - repo.saveAs(type, value) => hash
    // - repo.readRef(ref) => hash
    // - repo.updateRef(ref, hash) => hash
    // - repo.createTree(entries) => hash
    // - repo.hasHash(hash) => has
    require('js-github/mixins/github-db')(repo, githubName, githubToken);

    // Github has this built-in, but it's currently very buggy so we replace with
    // the manual implementation in js-git.
    require('js-git/mixins/create-tree')(repo);

    var localRepoCache = {};

    indexedDbCache(localRepoCache, githubName);

    // Cache github objects locally in indexeddb
    require('js-git/mixins/add-cache')(repo, localRepoCache);

    // Cache references in indexeddb
    require('js-git-ref-cache')(repo, localRepoCache);

    // Cache everything except blobs over 100 bytes in memory.
    // This makes path-to-hash lookup a sync operation in most cases.
    // require('js-git/mixins/mem-cache')(repo);

    // Combine concurrent read requests for the same hash
    require('js-git/mixins/read-combiner')(repo);

    // Add in value formatting niceties.  Also adds text and array types.
    require('js-git/mixins/formats')(repo);

    repos[githubName] = repo;

    return repo;
}

