var express = require('express');
var bodyParser = require('body-parser');
var ResponseModel = require('../models/ResponseModel');
var ErrorModel = require('../models/ErrorModel');


var JobsEng = function (db, socketIo) {
    this.DATABASE = db;
    this.socketIo = socketIo;
    this.router = express.Router();

    this._createDetailsRoute(this);
    this._createBuildShRoute(this);
    this._createSwaggerPyRoute(this);
    this._createGiudicoDeployStatusRoute(this);
    this._createGiudicoDeployStatusPut(this);
    this._createGiudicoDeployStatusAPI(this);
    this._handleError(this);
};

JobsEng.constructor = JobsEng;

JobsEng.BUILD_SH_DB = 'build-sh-usages';
JobsEng.SWAGGER_PY = 'swagger-py-usages';
JobsEng.GIUDICO_DEPLOY_STATUS = 'giudico-deploy-status';
JobsEng.EVENTS = {
    GIUDICO_DEPLOY_STATUS_CHANGE: 'gdsc'
};

JobsEng.Utils = {
    formatTimeStamp: function (timestampLong) {
        return new Date(timestampLong).toLocaleString('it-IT', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'Europe/Rome'
        });
    }
};

//MODEL {author: string, status: string, resource: string, timestamp: string}
JobsEng.prototype = {

    getRouter: function () {
        return this.router;
    },

    _createGiudicoDeployStatusAPI: function (self) {
        self.router.get('/api/jobs/eng/giudico/deploy-status', function (req, res) {
            console.log('%s: Received request for: "/jobs/eng/giudico/deploy-status"',
                new Date(Date.now()));
            if (!req.query.lastTime) {
                res.send({status: 'error', data: "Query parameter 'lastTime': long is required"})
            } else {

                var minTimestamp = JobsEng.Utils.formatTimeStamp(+req.query.lastTime);

                console.log(req.query.lastTime, minTimestamp);

                self.DATABASE.collection(JobsEng.GIUDICO_DEPLOY_STATUS).find({}).toArray(function (err, docs) {
                    if (self._handleDBError(err, res)) return;

                    var docsFiltered = docs
                        .map(function (el) {
                            el.timestamp = JobsEng.Utils.formatTimeStamp(el.timestamp);
                            delete el._id;
                            return el;
                        })
                        .filter(function (el) {
                            return el.timestamp > minTimestamp;
                        })
                        .sort(function (el1, el2) {
                            return el1.timestamp.localeCompare(el2.timestamp);
                        });

                    res.send({status: 'ok', data: docsFiltered});
                });
            }
        });
    },

    _createGiudicoDeployStatusRoute: function (self) {
        self.router.get('/jobs/eng/giudico/deploy-status', function (req, res) {
            console.log('%s: Received request for: "/jobs/eng/giudico/deploy-status"',
                new Date(Date.now()));

            var listResourceStatus = {};

            self.DATABASE.collection(JobsEng.GIUDICO_DEPLOY_STATUS).find({}).toArray(function (err, docs) {
                if (self._handleDBError(err, res)) return;

                console.log(docs);

                docs
                    .sort(function (el1, el2) {
                        return el1.resource.localeCompare(el2.resource);
                    })
                    .forEach(function (el) {
                        el.timestamp = new Date(el.timestamp);
                        el.time = JobsEng.Utils.formatTimeStamp(el.timestamp);
                        if (!listResourceStatus[el.resource]) {
                            listResourceStatus[el.resource] = el;
                        } else {
                            prevEl = listResourceStatus[el.resource];
                            if (prevEl.timestamp < el.timestamp) {
                                listResourceStatus[el.resource] = el;
                            }
                        }
                    });

                res.render('JobsEngGiudicoDeployStatus', {
                    listResourceStatus: listResourceStatus
                })
            })
        })
    },

    _createGiudicoDeployStatusPut: function (self) {
        self.router.put('/jobs/eng/giudico/deploy-status', bodyParser.json(), function (req, res) {
            console.log('%s: Received request for: "/jobs/eng/giudico/deploy-status"',
                new Date(Date.now()));
            console.log(req.originalUrl, '. Request body: ', req.body);

            self.socketIo.emit(JobsEng.EVENTS.GIUDICO_DEPLOY_STATUS_CHANGE, req.body);

            self.DATABASE.collection(JobsEng.GIUDICO_DEPLOY_STATUS).insertOne(req.body, function (err, result) {
                if (self._handleDBError(err, res)) return;

                console.log('---Saved to database', result.ops);
                res.send(new ResponseModel(ResponseModel.OK, result.insertedId));
            });
        })
    },

    _createDetailsRoute: function (self) {
        self.router.get('/jobs/eng/detail', function (req, res) {
            console.log('%s: Received request for: "/jobs/eng/detail"',
                new Date(Date.now()));
            var docsBuildSh, docsSwaggerPy;
            var totalBuildSh = 0, totalSwaggerPy = 0;

            var finish = function () {
                if (docsBuildSh && docsSwaggerPy) {
                    var totalUsages = {};
                    docsBuildSh.forEach(function (elem) {
                        if (!totalUsages[elem._id]) {
                            totalUsages[elem._id] = {};
                            totalUsages[elem._id]['countSwaggerPy'] = 0;
                        }
                        totalUsages[elem._id]['countBuildSh'] = elem.countBuildSh;
                        totalBuildSh += elem.countBuildSh;
                    });

                    docsSwaggerPy.forEach(function (elem) {
                        if (!totalUsages[elem._id]) {
                            totalUsages[elem._id] = {};
                            totalUsages[elem._id]['countBuildSh'] = 0;
                        }
                        totalUsages[elem._id]['countSwaggerPy'] = elem.countSwaggerPy;
                        totalSwaggerPy += elem.countSwaggerPy;
                    });

                    res.render('JobsEngDetail', {
                        totalUsages: totalUsages,
                        totalBuildSh: totalBuildSh,
                        totalSwaggerPy: totalSwaggerPy
                    });
                }
            };

            self.DATABASE.collection(JobsEng.BUILD_SH_DB).aggregate(
                [
                    {
                        "$group": {
                            "_id": "$author",
                            "countBuildSh": {"$sum": 1}
                        }
                    }
                ],
                function (err, cursor) {
                    if (self._handleDBError(err, res)) return;

                    cursor.toArray().then( function (docs) {

                        docsBuildSh = docs;

                        finish();
                    });
                }
            );

            self.DATABASE.collection(JobsEng.SWAGGER_PY).aggregate(
                [
                    {
                        "$group": {
                            "_id": "$author",
                            "countSwaggerPy": {"$sum": 1}
                        }
                    }
                ],
                function (err, cursor) {
                    if (self._handleDBError(err, res)) return;

                    cursor.toArray().then( function (docs) {
                        docsSwaggerPy = docs;

                        finish();
                    });
                }
            );

        })
    },

    _createBuildShRoute: function (self) {
        self.router.put('/jobs/eng/build-sh', bodyParser.json(), function (req, res) {
            console.log(req.originalUrl, '. Request body: ', req.body);

            self.DATABASE.collection(JobsEng.BUILD_SH_DB).insertOne(req.body, function (err, result) {
                if (self._handleDBError(err, res)) return;

                console.log('---Saved to database', result.ops);
                res.send(new ResponseModel(ResponseModel.OK, result.insertedId));
            });
        });
    },

    _createSwaggerPyRoute: function (self) {
        self.router.put('/jobs/eng/swagger-py', bodyParser.json(), function (req, res) {
            console.log(req.originalUrl, '. Request body: ', req.body);

            self.DATABASE.collection(JobsEng.SWAGGER_PY).insertOne(req.body, function (err, result) {
                if (self._handleDBError(err, res)) return;

                console.log('---Saved to database', result.ops);
                res.send(new ResponseModel(ResponseModel.OK, result.insertedId));
            });
        });
    },

    _handleDBError: function (err, res) {
        if (err) {
            res.send(new ResponseModel(ResponseModel.ERR, new ErrorModel(1, 'Save error: ' + err.message)));
            return console.log(err);
        }
    },

    _handleError: function (self) {
        self.router.use(function (err, req, res, next) {
            console.error(req.originalUrl, err.stack);
            if (err.status === 400) {
                var response = new ResponseModel(ResponseModel.ERR, new ErrorModel(2, 'Bad Request: ' + err.message));
                res.send(response);
            } else {
                next();
            }
        });
    }
};

module.exports = JobsEng;