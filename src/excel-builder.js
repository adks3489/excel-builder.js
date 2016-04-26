"use strict";
var _ = require('lodash');
var Workbook = require('./Excel/Workbook');
var work = require('webworkify');
var ZipJS = require('./ZipJS/zip.js').zip;
var waterfall = require("async/waterfall");

/**
 * @name Excel
 * @public
 * @author Stephen Liberty
 * @requires underscore
 * @requires Excel/Workbook
 * @exports excel-builder
 */
var Factory = {
    /**
     * Creates a new workbook.
     */
    createWorkbook: function () {
        return new Workbook();
    },

    config: {
        forceUIThread: false
    },

    /**
     * Turns a workbook into a downloadable file.
     * @param {Excel/Workbook} workbook The workbook that is being converted
     * @param {Object} options
     * @param {Boolean} options.base64 Whether to 'return' the generated file as a base64 string
     * @param {Function} options.success The callback function to run after workbook creation is successful.
     * @param {Function} options.error The callback function to run if there is an error creating the workbook.
     */
    createFileAsync: function (workbook, options) {
        workbook.generateFilesAsync({
            success: function (files) {
                var w = work(require('./Excel/ZipWorker.js'));
                w.addEventListener('message', function (event) {
                    if(event.data.status === 'done') {
                        options.success(event.data.data);
                    }
                });

                ZipJS.useWebWorkers = false;
                ZipJS.createWriter(new ZipJS.Data64URIWriter("vnd.openxmlformats-officedocument.spreadsheetml.sheet"), function(writer) {
                    var addFile = function(callback){
                        setTimeout(function(){
                            var path = this;
                            var content = files[path];
                            path = path.substr(1);
                            if(path.indexOf('.xml') !== -1 || path.indexOf('.rel') !== -1) {
                                writer.add(path, new ZipJS.TextReader(content), function(){
                                    callback();
                                }, undefined, {level: 0, version: 0x0a});
                            } else {
                                writer.add(path, new ZipJS.Data64URIReader(content), function(){
                                    callback();
                                }, undefined, {level: 0, version: 0x0a});
                            }
                        }.bind(this), 15);
                    };
                    var tasks = [];
                    for(var path in files) {
                        if(files.hasOwnProperty(path)) {
                            tasks.push(addFile.bind(path));
                        }
                    }
                    tasks.push(function(callback){
                        writer.close(function(base64data){
                            options.success(base64data.substring(66));
                            callback();
                        });
                    });
                    waterfall(tasks, function(){

                    });
                }, undefined, true);
            },
            error: function () {
                options.error();
            }
        });
    },

    /**
     * Turns a workbook into a downloadable file.
     * @param {Excel/Workbook} workbook The workbook that is being converted
     * @param {Object} options -
     */
    createFile: function (workbook, options) {
        var files = workbook.generateFiles();
        ZipJS.useWebWorkers = false;
        ZipJS.createWriter(new ZipJS.Data64URIWriter("vnd.openxmlformats-officedocument.spreadsheetml.sheet"), function(writer) {
            var addFile = function(callback){
                setTimeout(function(){
                    var path = this;
                    var content = files[path];
                    path = path.substr(1);
                    if(path.indexOf('.xml') !== -1 || path.indexOf('.rel') !== -1) {
                        writer.add(path, new ZipJS.TextReader(content), function(){
                            callback();
                        }, undefined, {level: 0, version: 0x0a});
                    } else {
                        writer.add(path, new ZipJS.Data64URIReader(content), function(){
                            callback();
                        }, undefined, {level: 0, version: 0x0a});
                    }
                }.bind(this), 15);
            };
            var tasks = [];
            for(var path in files) {
                if(files.hasOwnProperty(path)) {
                    tasks.push(addFile.bind(path));
                }
            }
            waterfall(tasks, function(){
                writer.close(function(base64data){
                    options.success(base64data.substring(66));
                });
            } );
        }, undefined, true);
    }
};

module.exports = Factory;
