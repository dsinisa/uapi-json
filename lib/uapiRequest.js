var Mustache = require('consolidate').handlebars;
var fs = require('fs');
var request = require('request');
var Promise = require('promise');
var uAPI_Parser = require('./uAPI_Parser');

//making default functions work with promises
var readFile = Promise.denodeify(fs.readFile);


var uError = require('./errors');
var fs = require('fs');


/**
 * basic function for requests/responses
 * @param  {string} service          service url for current response (gateway)
 * @param  {object} auth             {username,password} - credentials
 * @param  {string} reqType          url to file with xml for current request
 * @param  {function} validateFunction function for validation
 * @param  {function} errorHandler    function that gets SOAP:Fault object and handle error
 * @param  {function} parseFunction    function for transforming json soap object to object for terrans
 * @param  {boolean} debugMode        true - log requests, false - dont
 * @return {Promise}                  returning promise for best error handling ever)
 */
module.exports = function(service, auth, reqType, rootObject, validateFunction, errorHandler, parseFunction, debugMode){
    var config = require('./config')(auth.region || 'emea');
    debugMode = debugMode || false;
    if (debugMode > 2) console.log('Starting working with ', reqType,toString());
    if (service.length <= 0) {
        throw new uError('UNDEFINED_SERVICE_URL');
    }
    if (! auth || auth.username == undefined || auth.password == undefined) {
        throw new uError('UNDEFINED_AUTH_DATA');
    }

    if (reqType == undefined) {
        throw new uError('UNDEFINED_REQUEST_TYPE');
    }
    if (fs.existsSync(reqType) === false) {
        throw new uError('NO_TEMPLATE_FILE', {msg: reqType});
    }

    return function(params){

        if (debugMode) console.log('Input params ', params);

        var uParser = new uAPI_Parser(rootObject, 'v_36_0', params); //create a v36 uAPI parser with default params and request data in env

        var validateInput = function(resolve, reject){
            if (params == undefined) {
                reject(new uError('EMPTY_PARAMS'))
            }
            params = validateFunction(params);
            resolve(reqType);
        };

        var prepareRequest = function(data){
            //adding target branch param from auth variable and render xml
            params.TargetBranch = auth.targetBranch;
            params.Username = auth.username;
            params.pcc = auth.pcc;
            var renderedObj = Mustache.render(data.toString(), params);
            return renderedObj;
        };

        var prettifyRequest = function(data) {
            //TODO
            return data;
        };

        var sendRequest = function(xml){
            if (debugMode) console.log('Request XML: ', xml);
            return new Promise(function(resolve, reject) {
                request({
                    url: service, //URL to hit
                    method: 'POST',
                    timeout: config.timeout || 5000,
                    gzip: true,
                    'auth': {
                        'user': auth.username,
                        'pass': auth.password,
                        'sendImmediately': true
                    },
                    body: xml
                }, function(error, response, body) {
                    if (!error) {
                        if (debugMode > 1) console.log('Response SOAP: ', response.body);
                        resolve(response);
                    } else {
                        if (debugMode) console.log('Error Response SOAP: ', JSON.stringify(error));
                        if (error.code == 'ETIMEDOUT'){
                            reject(new uError('SOAP_REQUEST_TIMEOUT'));
                        } else {
                            reject(new uError('SOAP_REQUEST_ERROR'));
                        }
                    }
                });
            });
        };

        var parseResponse = function(response){

            //if there are web server or HTTP auth errors, uAPI returns a JSON
            try {
                var data = JSON.parse(response.body);
            } catch (err) {
                return uParser.parse(response.body);
            }

            //TODO parse JSON errors
            throw new uError('UNDEFINED_AUTH_DATA', data); //TODO change into UAPI_SERVER_ERROR, etc
        };

        var validateSOAP = function(parsedXML){

            if (parsedXML['SOAP:Fault']) {
                if (debugMode) console.log('Parsed error response', JSON.stringify(parsedXML));
                return errorHandler(parsedXML['SOAP:Fault']);
            } else
                if (debugMode > 1) console.log('Parsed response', JSON.stringify(parsedXML));

            return parsedXML;
        };

        var handleSuccess = function(result){
            if (debugMode > 1) console.log('Returning result', JSON.stringify(result));
            return result;
        };

        return new Promise(validateInput)
            .then(readFile)
            .then(prepareRequest)
            .then(sendRequest)
            .then(parseResponse)
            .then(validateSOAP)
            .then(parseFunction.bind(uParser))//TODO merge Hotels
            .then(handleSuccess);
    };
};
