/* jshint strict: false, node: true */
/* globals  onmessage: true, importScripts, postMessage */
"use strict";
var Worksheet = require('./Worksheet');
var _ = require('lodash');
module.exports = function (self) {
    var requireConfig;
    var worksheet;
    var start = function(data) {
        worksheet = new Worksheet({name: 'Temp'});
        worksheet.importData(data);
    };
    self.addEventListener('message',function (event){
        var data = event.data;
        if (typeof data === 'object') {
            switch (data.instruction) {
                case "start":
                    start(data.data);
                    postMessage({status: 'sharedStrings', data: worksheet.collectSharedStrings()});
                    break;
                case "export":
                    start(data.data);
                    worksheet.setSharedStringCollection({
                        strings: data.sharedStrings
                    });
                    postMessage({status: "finished", data: worksheet.toXML().toString(), worksheetIndex: data.worksheetIndex});
                    break;
            }
        }
    });
};
