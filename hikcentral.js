(async () => {
    const nodeEnv = 'undefined' != typeof process ? process : {};

    if ('development' == nodeEnv?.env?.NODE_ENV) {
        //Bypasses TLS certificate verification. It should be only for dev enviroments.
         process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
     }

    const apiServerUrl = nodeEnv?.env?.HIKVISION_API_URL || 'https://172.30.4.200';
    const partnerKey = nodeEnv?.env?.HIKVISION_PARTNER_KEY || '25446123';
    const partnerSecret = nodeEnv?.env?.HIKVISION_PARTNER_SECRET || 'JoA8ewu3t3BzKFRZgT0J';
    /*const apiServerUrl = nodeEnv.env?.HIKVISION_API_URL || 'https://172.20.2.99';
    const partnerKey = nodeEnv?.env?.HIKVISION_PARTNER_KEY || '23827199';
    const partnerSecret = nodeEnv?.env?.HIKVISION_PARTNER_SECRET || 'nFoLQWdyyf5WeRCEUEZr';*/
    const pageSize = 500;
    const maxSimultaneousStreams = 25;
    const endpoints = {
        version: '/artemis/api/common/v1/version',
        encodeDeviceList: '/artemis/api/resource/v1/encodeDevice/encodeDeviceList',
		encodeDevice: '/artemis/api/resource/v1/encodeDevice/indexCode/encodeDeviceInfo',
        cameraList: '/artemis/api/resource/v1/camera/advance/cameraList',
        camera: '/artemis/api/resource/v1/cameras/indexCode',
        previewURLs: '/artemis/api/video/v2/cameras/previewURLs',
        previewURL: '/artemis/api/video/v1/cameras/previewURLs',
        capture: '/artemis/api/video/v1/camera/capture',
        ptz: '/artemis/api/video/v1/ptzs/controlling',
        presets: '/artemis/api/video/v1/presets/searches',
        patrols: '/artemis/api/video/v1/patrols/searches',
        areas: '/artemis/api/resource/v1/regions',
		area: '/artemis/api/resource/v1/region/indexCode/regionInfo'
    }
	const commonHashParams = {
        method: 'POST',
        accept: 'application/json',
        charset: 'text/plain;charset=UTF-8',
        key: `x-ca-key:${partnerKey}`,
        endpoint: ''
    }
	const hashParams = Object.keys(endpoints).reduce((acc, key) => {
        acc[key] = {...commonHashParams, endpoint: endpoints[key]};

        if ('version' == key) {    
            acc[key].accept = '*/*';

            delete acc[key].charset;
        }

        return acc;
    }, {});
	const params = Object.keys(endpoints).reduce((acc, key) => {
        acc[key] = {
			method: hashParams[key].method,
			headers: {
				"accept": hashParams[key].accept,
				'x-ca-key': partnerKey,
				'x-ca-signature-headers': 'x-ca-key',
				'x-ca-signature': ''
			}
		};

        return acc;
    }, {});
	
	const createHmacSHA256 = async (key, secret) => {
        const encoder = new TextEncoder();
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(key),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
   
        const signature = await crypto.subtle.sign(
            'HMAC',
            cryptoKey,
            encoder.encode(secret)
        );
   
        return btoa(String.fromCharCode(...new Uint8Array(signature)));
    }

    const getInvalidIndexCodeObject = () => {
        return {
            status: 'fail',
            data: 'Invalid index code'
        };
    }

    const runFetch = async (endpoint = '', options = {}, hasCustomUpperLevelOptions = false) => {
        if (! endpoint || 'string' !== typeof endpoint || '' == endpoint.trim()) {
            throw new Error('Invalid or missing endpoint');
        }

        if (! options || 'object' !== typeof options || ! Object.keys(options)?.length) {
            throw new Error('Invalid or missing options');
        }

        const result = {
            res: {},
            httpStatusCode: 200,
            httpStatusText: 'OK',
            status: 'success',
            data: {}
        };

        const fetchOptionKeys = [
            'method', 'headers', 'body', 'mode', 'credentials', 'cache', 'redirect', 'referrer',
            'referrerpolicy', 'signal', 'integrity', 'keepalive', 'priority'
        ].map(k => k.toLowerCase());

        const defaultOpts = {
            method: 'GET',
            headers: {
                accept: 'application/json, text/plain, */*'
            },
            signal: AbortSignal.timeout(Number(10000))
        };

        const abortKey = Object.keys(options).find(o => ['abort', 'signal', 'timeout'].includes(o.toLowerCase()));

        if (abortKey) {
            const signalValue = options[abortKey];
            
            if (signalValue instanceof AbortSignal) {
                defaultOpts.signal = signalValue;
            } else if (/^\d+$/.test(signalValue)) {
                defaultOpts.signal = AbortSignal.timeout(Number(signalValue));
            } else {
                console.warn('Invalid signal or timeout value; using default signal.');
            }

            delete options[abortKey];
        }

        if (options.headers) {
            if ('object' === typeof options.headers && Object.keys(options.headers)?.length) {
                Object.assign(defaultOpts.headers, options.headers);
            }

            if (! hasCustomUpperLevelOptions) {
                delete options.headers;
            }
        }

        for (const [k, v] of Object.entries(options)) {
            if (fetchOptionKeys.includes(k.toLowerCase())) {
                defaultOpts[k] = v;
            } else {
                defaultOpts.headers[k] = v;
            }
        }

        const getResponseContent = async (responseObj, type = 'json', isClone = false) => {
            const clonedResponse = responseObj.clone();
            const tryResult = { status: 'success', data: {} };

            try {
                tryResult.data = await responseObj[type]();
            } catch (err) {
                tryResult.status = 'fail';
                tryResult.data = err;

                // Fallback to text if main format fails and we haven't cloned yet
                if (! isClone) {
                    const tryResultFromClone = await getResponseContent(clonedResponse, 'text', true);

                    return tryResultFromClone;
                }
            }

            return tryResult;
        };

        try {
            const response = await fetch(endpoint, ! hasCustomUpperLevelOptions ? defaultOpts : options);
            const contentHeader = response.headers.get('content-type') || 'application/json';
            const contentTypeMethodKeywords = {
                json: ['json'],
                text: ['text', 'html', 'css', 'javascript', 'xml'],
                blob: ['octet-stream', 'image', 'audio', 'video', 'pdf'],
                formData: ['multipart', 'form-data']
            };
            const contentType = Object.keys(contentTypeMethodKeywords).find((k) => 
                contentTypeMethodKeywords[k].some((w) => 
                    contentHeader.toLowerCase().includes(w.toLowerCase())
                )
            ) || 'json';

            result.res = response;
            result.httpStatusCode = response.status;
            result.httpStatusText = response.statusText;
            result.headers = Object.fromEntries(response.headers.entries());

            if (! response.ok) {
                result.status = 'fail';
                result.ok = false;
            } else {
                result.ok = true;
            }

            const parsed = await getResponseContent(response, contentType);

            if (parsed.data?.data && 'object' == typeof parsed.data.data && Object.keys(parsed.data.data).length) {
                Object.assign(parsed.data, parsed.data.data);

                delete parsed.data.data;
            }

            if ('object' == typeof parsed.data && Object.keys(parsed.data)?.length) {
                Object.keys(parsed.data).forEach((k) => {
                    if (['info', 'success', 'warning', 'danger', 'accent'].includes(k)) { result.severity = k; }
                });
            }

            if ('fail' == parsed.status) { result.status = 'fail'; }
            
            result.data = parsed.data;
        } catch (err) {
            result.status = 'fail';
            result.httpStatusCode = err?.name === 'AbortError' ? 408 : 503;
            result.httpStatusText = err?.message || 'Service Unavailable';
            result.data = err;

            if (err?.stack) { result.stack = err.stack; }
            if (err?.name) { result.name = err.name; }
        }

        return result;
    };
	
	const getISO8601Timestamp = (date = false) => {
        const d = ! date ? new Date() : new Date(date);
        const tzo = d.getTimezoneOffset();
        const timezone = tzo == 0 ? '00:00' : (tzo > 0 ? '-' : '+') + (tzo / 60).toFixed(2).split('.').map((e, i) => (i > 0 ? (Math.round(60 * Number('0.' + e))).toString() : e).padStart(2, '0')).join(':');
        
        return new Date(d - tzo * 60 * 1000).toJSON().replace('Z', timezone);
    }
	
	const setParams = async () => {
        const paramsKeys = Object.keys(params);

        for (let i = 0; i < paramsKeys.length; i++) {
            params[paramsKeys[i]]['headers']['x-ca-signature'] = await createHmacSHA256(partnerSecret, Object.values(hashParams[paramsKeys[i]]).join('\n'));
        }

		return true;
	}

    const getHikcentralVersion = async () => {		
		/*
        Returns an object like this one:
        {
			"res": {},
			"httpStatusCode": 200,
			"httpStatusText": "OK",
			"status": "success",
			"data": {
				"code": "0",
				"msg": "Success",
				"produceName": "HikCentral Professional",
				"softVersion": "V2.6.0.0"
			},
			"headers": {
				"cache-control": "no-cache",
				"connection": "keep-alive",
				"content-encoding": "gzip",
				...More headers
			},
			"ok": true
		}
        */
        return await runFetch(apiServerUrl + endpoints.version, params.version, true);
    }
	
	const getAllPages = async (data, endpoint, params) => {
        if (! data?.total || data.total <= pageSize) {
            return;
        }

        const pages  = Math.ceil(data.total / pageSize);
        const pagePromises = [];

        for (let i = 2; i <= pages; i++) {
            params.body = JSON.stringify({
                pageNo: i,
                pageSize: pageSize
            });

            pagePromises.push(runFetch(apiServerUrl + endpoint, params, true));
        }

        const pageResults = await Promise.all(pagePromises);

        pageResults.forEach((result) => {
            if (result?.data?.list?.length) {
                data.list = data.list.concat(result.data.list);
            }
        });
    }

    const getEncodeDevices = async () => {		
        params.encodeDeviceList.body = JSON.stringify({pageNo: 1, pageSize});

        const encodeDeviceListResult = await runFetch(apiServerUrl + endpoints.encodeDeviceList, params.encodeDeviceList, true);
        const ecData = encodeDeviceListResult?.data;

        if (ecData?.total && ecData?.list?.length && ecData.total > ecData.list.length) {
            await getAllPages(ecData, endpoints.encodeDeviceList, params.encodeDeviceList);
        }

        /*
        Returns an object like this one:
        {
			"res": {},
			"httpStatusCode": 200,
			"httpStatusText": "OK",
			"status": "success",
			"data": {
				"code": "0",
				"msg": "Success",
				"total": 46,
				"pageNo": 1,
				"pageSize": 500,
				"list": [
					{
						"encodeDevIndexCode": "118",
						"encodeDevName": "BOTONCILLO ALMACEN ZN",
						"encodeDevIp": "10.201.29.4",
						"encodeDevPort": "8000",
						"encodeDevCode": "DS-7716NI-I4/16P(B)1620220329CCRRJ72197760WCVU",
						"treatyType": "hiksdk_net",
						"status": 1,
						"isSupportWakeUp": 0,
						"wakeUpStatus": -1,
						"pictureStorePosType": 0
					},
					{
						"encodeDevIndexCode": "117",
						"encodeDevName": "JAIBON COMERCIAL",
						"encodeDevIp": "10.201.44.4",
						"encodeDevPort": "8000",
						"encodeDevCode": "DS-7608NI-I2/8P0820220325CCRRJ71769442WCVU",
						"treatyType": "hiksdk_net",
						"status": 2,
						"isSupportWakeUp": 0,
						"wakeUpStatus": -1,
						"pictureStorePosType": 0
					},
					{
						"encodeDevIndexCode": "109",
						"encodeDevName": "Baitoa Comercial",
						"encodeDevIp": "10.201.15.200",
						"encodeDevPort": "8000",
						"encodeDevCode": "DS-7608NI-I2/8P0820220325CCRRJ71769368WCVU",
						"treatyType": "hiksdk_net",
						"status": 1,
						"isSupportWakeUp": 0,
						"wakeUpStatus": -1,
						"pictureStorePosType": 0
					},
					{
						"encodeDevIndexCode": "108",
						"encodeDevName": "DIRECCION EJECUTIVA",
						"encodeDevIp": "10.19.1.200",
						"encodeDevPort": "8000",
						"encodeDevCode": "DS-7616NI-K2/16P1620240513CCRRFE1949714WCVU",
						"treatyType": "hiksdk_net",
						"status": 2,
						"isSupportWakeUp": 0,
						"wakeUpStatus": -1,
						"pictureStorePosType": 0
					},
					...More devices
				]
			},
			"headers": {
				"cache-control": "no-cache",
				"connection": "keep-alive",
				"content-encoding": "gzip",
				...More headers
			},
			"ok": true
		}
        */
        return encodeDeviceListResult;
    }
	
	const getEncodeDevice = async (indexCode = '') => {
        if (! indexCode || ! ['string', 'number'].includes(typeof indexCode) || ('string' === typeof indexCode && ! indexCode.trim())) {
            return getInvalidIndexCodeObject();
        }

        params.encodeDevice.body = JSON.stringify({encodeDevIndexCode: indexCode.toString()});
        
        /*
        Returns an object like this one:
        {
            "res": {},
            "httpStatusCode": 200,
            "httpStatusText": "OK",
            "status": "success",
            "data": {
                "code": "0",
                "msg": "Success",
                "encodeDevIndexCode": "81",
                "encodeDevName": "Arroyo Gurabo Santiago",
                "encodeDevIp": "10.100.63.200",
                "encodeDevPort": "8000",
                "encodeDevCode": "DS-9664NI-I81620220822CCRRK45226306WCVU",
                "treatyType": "hiksdk_net",
                "status": 1,
                "isSupportWakeUp": 0,
                "wakeUpStatus": -1,
                "pictureStorePosType": 0,
                "timeZone": {
                    "enableDST": 1,
                    "bias": 480,
                    "daylightBias": -60,
                    "daylightDate": "3:2:0:2:0",
                    "standardDate": "11:1:0:2:0"
                }
            },
            "headers": {
                "cache-control": "no-cache",
                "connection": "keep-alive",
                "content-encoding": "gzip",
                ...More headers
            },
            "ok": true
        }
        */
        return await runFetch(apiServerUrl + endpoints.encodeDevice, params.encodeDevice, true);
    }

    const getCameras = async () => {		
        params.cameraList.body = JSON.stringify({pageNo: 1, pageSize});

        const cameraListResult = await runFetch(apiServerUrl + endpoints.cameraList, params.cameraList, true);
        const cameraData = cameraListResult?.data;

        if (cameraData?.total && cameraData?.list?.length && cameraData.total > cameraData.list.length) {
            await getAllPages(cameraData, endpoints.cameraList, params.cameraList);
        }

        /*
        Returns an object like this one:
        {
			"res": {},
			"httpStatusCode": 200,
			"httpStatusText": "OK",
			"status": "success",
			"data": {
				"code": "0",
				"msg": "Success",
				"total": 543,
				"pageNo": 1,
				"pageSize": 500,
				"list": [
					{
						"cameraIndexCode": "621",
						"cameraName": " GARITA",
						"capabilitySet": "event_pdc",
						"devResourceType": "encodeDevice",
						"encodeDevIndexCode": "81",
						"recordType": "0",
						"recordLocation": "1",
						"regionIndexCode": "25",
						"siteIndexCode": "0",
						"status": 1,
						"isSupportWakeUp": 0,
						"wakeUpStatus": 0
					},
					{
						"cameraIndexCode": "619",
						"cameraName": " PARQUEO",
						"capabilitySet": "event_pdc",
						"devResourceType": "encodeDevice",
						"encodeDevIndexCode": "81",
						"recordType": "0",
						"recordLocation": "1",
						"regionIndexCode": "25",
						"siteIndexCode": "0",
						"status": 1,
						"isSupportWakeUp": 0,
						"wakeUpStatus": 0
					},
					{
						"cameraIndexCode": "307",
						"cameraName": " Parqueo ",
						"capabilitySet": "event_pdc",
						"devResourceType": "encodeDevice",
						"encodeDevIndexCode": "9",
						"recordType": "0",
						"recordLocation": "1",
						"regionIndexCode": "7",
						"siteIndexCode": "0",
						"status": 1,
						"isSupportWakeUp": 0,
						"wakeUpStatus": 0
					},
					{
						"cameraIndexCode": "78",
						"cameraName": " PARQUEO SALIDA FURGONES",
						"capabilitySet": "ptz,event_pdc",
						"devResourceType": "encodeDevice",
						"encodeDevIndexCode": "1",
						"recordType": "0",
						"recordLocation": "1",
						"regionIndexCode": "1",
						"siteIndexCode": "0",
						"status": 1,
						"isSupportWakeUp": 0,
						"wakeUpStatus": 0
					},
					...More cameras
				]
			},
			"headers": {
				"cache-control": "no-cache",
				"connection": "keep-alive",
				"content-encoding": "gzip",
				...More headers
			},
			"ok": true
		}
        */
        return cameraListResult;
    }

    const getCamera = async (indexCode = '') => {
        if (! indexCode || ! ['string', 'number'].includes(typeof indexCode) || ('string' === typeof indexCode && ! indexCode.trim())) {
            return getInvalidIndexCodeObject();
        }

        params.camera.body = JSON.stringify({cameraIndexCode: indexCode.toString()});
        
        /*
        Returns an object like this one:
        {
			"res": {},
			"httpStatusCode": 200,
			"httpStatusText": "OK",
			"status": "success",
			"data": {
				"code": "0",
				"msg": "Success",
				"cameraIndexCode": "621",
				"cameraName": " GARITA",
				"capabilitySet": "event_pdc",
				"devResourceType": "encodeDevice",
				"cameraGuid": "A2179757AEE14A6BB248344C08650C2C",
				"encodeDevIndexCode": "81",
				"recordType": "0",
				"recordLocation": "1",
				"regionIndexCode": "25",
				"siteIndexCode": "0",
				"status": 1,
				"isSupportWakeUp": 0,
				"wakeUpStatus": 0
			},
			"headers": {
				"cache-control": "no-cache",
				"connection": "keep-alive",
				"content-encoding": "gzip",
				...More headers
			},
			"ok": true
		}
        */
        return await runFetch(apiServerUrl + endpoints.camera, params.camera, true);
    }

    const getCameraStatus = async (indexCode = '') => {
        const cameraData = await getCamera(indexCode);

        if (cameraData?.data?.status) { cameraData.data = cameraData.data.status; }

        /*
        Returns an object like this one:
        {
			"res": {},
			"httpStatusCode": 200,
			"httpStatusText": "OK",
			"status": "success",
			"data": 1,
			"headers": {
				"cache-control": "no-cache",
				"connection": "keep-alive",
				"content-encoding": "gzip",
				...More headers
			},
			"ok": true
		}
        */
        return cameraData;
    }

    const getCamerasPreviewURLs = async (indexCodes = '', protocol = 'websocket', checkForMax = true) => {
        const protocols = ['rtsp', 'websocket', 'rtsp_s', 'websocket_s', 'hls', 'rtmp'];
        const invalidIndexMsg = getInvalidIndexCodeObject();
        const previewURLsFetches = [];
        const urlsDataObj = {};

        invalidIndexMsg.data += '(s)';

        if (! indexCodes || ! ['string', 'number'].includes(typeof indexCodes) || ('string' === typeof indexCodes && ! indexCodes.trim())) {
            return invalidIndexMsg;
        }

        if (! protocol || 'string' != typeof protocol || ! protocol.trim() || ! protocols.includes(protocol.toLowerCase())) {
            return {
                status: 'fail',
                data: 'Invalid protocol'
            };
        }
        
        indexCodes = indexCodes.split(',').map(c => c.trim().toString()) || [];

        if (! indexCodes.length) { return invalidIndexMsg; }

        //Limit the number of simultaneous streams to avoid overloading the server
        if (checkForMax && indexCodes.length > maxSimultaneousStreams) {
            indexCodes = indexCodes.slice(0, maxSimultaneousStreams);
        }

        const bodyPreview = {
            cameraIndexCodes: indexCodes.join(','),//Comma separated string of cameraIndexCodes
            streamType: 0,//0-main stream, 1-sub stream
            protocol: protocol,//Streaming protocol type: "rtsp" (default), "websocket" (for JsDecoder SDK), "rtsp_s" (for encrypted stream via standard RTSP), "websocket_s", "hls", "rtmp"
            //transmode: 1,//Transfer mode: 0-UDP, 1-TCP (default)
            //requestWebsocketProtocol: 1//Streaming type of websocket: 0-ws, 1-wss. This parameter is required when the value of protocol is "websocket".
        }

        if ('websocket' == protocol.toLowerCase()) { bodyPreview.requestWebsocketProtocol = 0; }
        if ('websocket_s' == protocol.toLowerCase()) { bodyPreview.requestWebsocketProtocol = 1; }

        params.previewURLs.body = JSON.stringify(bodyPreview);
        
        previewURLsFetches.push(runFetch(apiServerUrl + endpoints.previewURLs, params.previewURLs, true));

        bodyPreview.streamType = 1;

        params.previewURLs.body = JSON.stringify(bodyPreview);

        previewURLsFetches.push(runFetch(apiServerUrl + endpoints.previewURLs, params.previewURLs, true));

        const previewURLsResults = await Promise.all(previewURLsFetches);
        const mainStreamUrls = previewURLsResults?.[0]?.data?.list;
        const subStreamUrls = previewURLsResults?.[1]?.data?.list;

        if (mainStreamUrls?.length) {
            mainStreamUrls.forEach((m, i) => {
                urlsDataObj[indexCodes[i].toString()] = {mainStream: m?.url || ''};
            });   
        }

        if (subStreamUrls?.length) {
            subStreamUrls.forEach((m, i) => {
                if (urlsDataObj[indexCodes[i].toString()] && Object.keys(urlsDataObj[indexCodes[i].toString()])) {
                    urlsDataObj[indexCodes[i].toString()]['subStream'] = m?.url || '';
                }
            });
        }

        if (mainStreamUrls?.length) {
            previewURLsResults[0].data.list = urlsDataObj;
        }

        /*
        Returns an object like this one:
		{
			"res": {},
			"httpStatusCode": 200,
			"httpStatusText": "OK",
			"status": "success",
			"data": {
				"code": "0",
				"msg": "Success",
				"list": {
					"619": {
						"mainStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55pngI35uWNl%2FcQ79V8%2F939Jw8Mz8wGCiyxejgmuJQRV91xNMxbujsvisvRKek3Em4ghamBsfijXEspB%2Bdofwis6147WZHk9qMuIAo1Yz6Azphfx5PgQ5ru%2Bc%2BA3QSycHOvs88SvOSts866cRjEGeCVVtc5oAMZ8rTlipTevZYviuEdUcHyr6X%2BvR4ULOxzqe9og%3D",
                        "subStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55pngI35uWNl%2FcQ79V8%2F939Jw8Mz8wGCiyxejgmuJQRV91xNMxbujsvisvRKek3Em4ghamBsfijXEspB%2Bdofwis6147WZHk9qMuIAo1Yz6Azphfx5PgQ5ru%2Bc%2BA3QSycHOvs88SvOSts866cRjEGeCVVtc5oAMZ8rTlipTevZYviuEdUcHyr6X%2BvR4ULOxzqe9og%3D"
					},
					"621": {
						"mainStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55plbas%2FVVNGN5XFViDjJLyf5mSWDxbFzZPRkhxm%2BwFie4fejBr8hp0meWG0NPEqV%2FJvz1BefFDYlUMQkZ8fVMuQHLRwGSIehM%2F169k1nYFcG8JMow7SDi%2B590xyXHHoUgLAqUAeDE910SnBiGPs3lSbI8ejrkaYhr%2F51NI0ceXVAW5Nk3KcAUKZlNjRmD%2F4%2BmIs%3D",
                        "subStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55plbas%2FVVNGN5XFViDjJLyf5mSWDxbFzZPRkhxm%2BwFie4fejBr8hp0meWG0NPEqV%2FJvz1BefFDYlUMQkZ8fVMuQHLRwGSIehM%2F169k1nYFcG8JMow7SDi%2B590xyXHHoUgLAqUAeDE910SnBiGPs3lSbI8ejrkaYhr%2F51NI0ceXVAW5Nk3KcAUKZlNjRmD%2F4%2BmIs%3D"
					}
				}
			},
			"headers": {
				"cache-control": "no-cache",
				"connection": "keep-alive",
				"content-encoding": "gzip",
				...More headers
			},
			"ok": true
		}
        */
        return previewURLsResults?.[0] || {};
    }

    const getCameraPreviewURL = async (indexCode = '', protocol = 'websocket') => {
        const protocols = ['rtsp', 'websocket', 'rtsp_s', 'websocket_s', 'hls', 'rtmp'];
        const previewURLFetches = [];

        if (! indexCode || ! ['string', 'number'].includes(typeof indexCode) || ('string' === typeof indexCode && ! indexCode.trim())) {
            return getInvalidIndexCodeObject();
        }

        if (! protocol || 'string' != typeof protocol || ! protocol.trim() || ! protocols.includes(protocol.toLowerCase())) {
            return {
                status: 'fail',
                data: 'Invalid protocol'
            };
        }

        const bodyPreview = {
            cameraIndexCode: indexCode.toString(),
            streamType: 0,
            protocol: protocol
        }

        if ('websocket' == protocol.toLowerCase()) { bodyPreview.requestWebsocketProtocol = 0; }
        if ('websocket_s' == protocol.toLowerCase()) { bodyPreview.requestWebsocketProtocol = 1; }

        params.previewURL.body = JSON.stringify(bodyPreview);

        previewURLFetches.push(runFetch(apiServerUrl + endpoints.previewURL, params.previewURL, true));

        bodyPreview.streamType = 1;

        params.previewURL.body = JSON.stringify(bodyPreview);

        previewURLFetches.push(runFetch(apiServerUrl + endpoints.previewURL, params.previewURL, true));

        const previewURLResults = await Promise.all(previewURLFetches);

        if (previewURLResults?.[0]?.data?.url) {
            previewURLResults[0].data.mainStream = previewURLResults[0].data.url;

            delete previewURLResults[0].data.url;

            if (previewURLResults?.[1]?.data?.url) {
                previewURLResults[0].data.subStream = previewURLResults[1].data.url;
            }

        }
        
        /*
        Returns an object like this one:
        {
			"res": {},
			"httpStatusCode": 200,
			"httpStatusText": "OK",
			"status": "success",
			"data": {
				"code": "0",
				"msg": "Success",
				"mainStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55plbas%2FVVNGN5XFViDjJLyf5mSWDxbFzZPRkhxm%2BwFie4fejBr8hp0meWG0NPEqV%2FJvz1BefFDYlUMQkZ8fVMuQHLRwGSIehM%2F169k1nYFcG8JMow7SDi%2B590xyXHHoUgLAqUAeDE910SnBiGPs3lSbI8ejrkaYhr%2F51NI0ceXVAW6HFd0a6SIPBJ2B%2BX9hIpPM%3D",
                "subStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55plbas%2FVVNGN5XFViDjJLyf5mSWDxbFzZPRkhxm%2BwFie4fejBr8hp0meWG0NPEqV%2FJvz1BefFDYlUMQkZ8fVMuQHLRwGSIehM%2F169k1nYFcG8JMow7SDi%2B590xyXHHoUgLAqUAeDE910SnBiGPs3lSbI8ejrkaYhr%2F51NI0ceXVAW6HFd0a6SIPBJ2B%2BX9hIpPM%3D"
			},
			"headers": {
				"cache-control": "no-cache",
				"connection": "keep-alive",
				"content-encoding": "gzip",
				...More headers
			},
			"ok": true
		}
        */

        return previewURLResults?.[0] || {};
    }

    const getCameraCapture = async (indexCode = '') => {
        if (! indexCode || ! ['string', 'number'].includes(typeof indexCode) || ('string' === typeof indexCode && ! indexCode.trim())) {
            return getInvalidIndexCodeObject();
        }
        
        params.capture.body = JSON.stringify({cameraIndexCode: indexCode.toString()});
		
		return await runFetch(apiServerUrl + endpoints.capture, params.capture, true);
        /*
        Returns an object like this one:
        {
			"res": {},
			"httpStatusCode": 200,
			"httpStatusText": "OK",
			"status": "success",
			"data": {
				"code": "0",
				"msg": "Success",
				"data": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wDFAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYakAAA==",
			},
			"headers": {
				"cache-control": "no-cache",
				"connection": "keep-alive",
				"content-encoding": "gzip",
				...More headers
			},
			"ok": true
		}
        */
        return result;
    }
    
    const getPTZPresets = async (indexCode = '') => {
		if (! indexCode || ! ['string', 'number'].includes(typeof indexCode) || ('string' === typeof indexCode && ! indexCode.trim())) {
            return getInvalidIndexCodeObject();
        }

        params.presets.body = JSON.stringify({cameraIndexCode: indexCode.toString()});
		
        /*
        Returns an object like this one:
        {
            "res": {},
            "httpStatusCode": 200,
            "httpStatusText": "OK",
            "status": "success",
            "data": {
                "code": "0",
                "msg": "Success",
                "total": 256,
                "list": [
                    {
                        "presetName": "Preset 1",
                        "presetIndex": 1
                    },
                    {
                        "presetName": "Preset 2",
                        "presetIndex": 2
                    },
                    {
                        "presetName": "Preset 3",
                        "presetIndex": 3
                    },
                    {
                        "presetName": "Preset 4",
                        "presetIndex": 4
                    },
                    {
                        "presetName": "Preset 5",
                        "presetIndex": 5
                    }
                ]
            },
            "headers": {
                "cache-control": "no-cache",
                "connection": "keep-alive",
                "content-encoding": "gzip",
                ...More headers
            },
            "ok": true
        }
        */
        return await runFetch(apiServerUrl + endpoints.presets, params.presets, true);
    }
    
    const getPTZPatrols = async (indexCode = '') => {
		if (! indexCode || ! ['string', 'number'].includes(typeof indexCode) || ('string' === typeof indexCode && ! indexCode.trim())) {
            return getInvalidIndexCodeObject();
        }

        params.patrols.body = JSON.stringify({cameraIndexCode: indexCode.toString()});
		
        /*
        Returns an object like this one:
        {
            "res": {},
            "httpStatusCode": 200,
            "httpStatusText": "OK",
            "status": "success",
            "data": {
                "code": "0",
                "msg": "Success",
                "total": 1,
                "list": [
                    {
                        "patrolName": "cruise1",
                        "patrolIndex": 1,
                        "PatrolPointInfo": {
                            "presetIndex": 1,
                            "speed": 4,
                            "dwellTime": 15
                        }
                    }
                ]
            },
            "headers": {
                "cache-control": "no-cache",
                "connection": "keep-alive",
                "content-encoding": "gzip",
                ...More headers
            },
            "ok": true
        }
        */
		return await runFetch(apiServerUrl + endpoints.patrols, params.patrols, true);
    }
    
    const controlPTZ = async (cameraIndexCode = '', command = '', action = '') => {
        const validCommands = ['LEFT', 'RIGHT', 'UP', 'DOWN', 'ZOOM_IN', 'ZOOM_OUT', 'LEFT_UP', 'LEFT_DOWN', 'RIGHT_UP', 'RIGHT_DOWN', 'FOCUS_NEAR', 'FOCUS_FAR', 'IRIS_ENLARGE', 'IRIS_REDUCE', 'GOTO_PRESET', 'RUN_PATROL'];
        const validActions = ['0', '1'];
        
        if ([cameraIndexCode, command, action].some(v => ! v || ! ['string', 'number'].includes(typeof v))) {
            return {
                status: 'fail',
                data: 'Invalid camera index code, command or action'
            };
        }

        cameraIndexCode = cameraIndexCode.toString();
        command = command.toString();
        action = action.toString();

        if (! cameraIndexCode.trim()) {
            return getInvalidIndexCodeObject();
        }

        if (! command.trim()) {
            return {
                status: 'fail',
                data: 'Invalid command'
            };
        }

        if (! action.trim()) {
            return {
                status: 'fail',
                data: 'Invalid action'
            };
        }
        
        if (! validCommands.includes(command)) { return { status: 'fail', data: 'Invalid command' }; }

        if (! validActions.includes(action)) { return { status: 'fail', data: 'Invalid action' }; }

        /*
        {
            "cameraIndexCode": "118",
            "command": "LEFT",//"LEFT", "RIGHT", "UP", "DOWN", "ZOOM_IN", "ZOOM_OUT", "LEFT_UP", "LEFT_DOWN", "RIGHT_UP", "RIGHT_DOWN", "FOCUS_NEAR", "FOCUS_FAR", "IRIS_ENLARGE", "IRIS_REDUCE", "GOTO_PRESET", "RUN_PATROL"
            //"presetIndex": 20,
            "action": 1,//Start or stop control: 0-start, 1-stop.
            //"speed": 4,//Required only for commands "GOTO_PRESET" and "RUN_PATROL".
            //"PatrolIndex": 5
        }
        */
        params.ptz.body = JSON.stringify({
            cameraIndexCode,
            command,
            action
        });

        /*
        Returns an object like this one:
        {
			"res": {},
			"httpStatusCode": 200,
			"httpStatusText": "OK",
			"status": "success",
			"data": {
				"code": "0",
				"msg": "Success",
				"data": ""
			},
			"headers": {
				"cache-control": "no-cache",
				"connection": "keep-alive",
				"content-encoding": "gzip",
				...More headers
			},
			"ok": true
		}
        */
        return await runFetch(apiServerUrl + endpoints.ptz, params.ptz, true);
    }
    
    const getAreas = async () => {
        params.areas.body = JSON.stringify({pageNo: 1, pageSize});

        const areasResult = await runFetch(apiServerUrl + endpoints.areas, params.areas, true);
        const areasData = areasResult?.data;

        if (areasData?.total && areasData?.list?.length && areasData.total > areasData.list.length) {
            await getAllPages(areasData, endpoints.areas, params.areas);
        }

        //Let's make all indexCodes top level
        if (areasData?.list?.length) {
            areasData.list = areasData.list.map((m) => {
                if ('-1' != m.parentIndexCode) {
                    m.indexCode = m.parentIndexCode;
                    m.parentIndexCode = '-1';
                }
                
                return m;
            });
        }

        /*
        Returns an object similar to this one:
        {
			"res": {},
			"httpStatusCode": 200,
			"httpStatusText": "OK",
			"status": "success",
			"data": {
				"code": "0",
				"msg": "Success",
				"total": 46,
				"pageNo": 1,
				"pageSize": 500,
				"list": [
					{
						"indexCode": "20",
						"parentIndexCode": "-1",
						"siteIndexCode": "0",
						"name": "ACUEDUCTO RURALES INAPA CENTRAL"
					},
					{
						"indexCode": "2",
						"parentIndexCode": "-1",
						"siteIndexCode": "0",
						"name": "ALMACEN KM18 NVR-1"
					},
					{
						"indexCode": "3",
						"parentIndexCode": "-1",
						"siteIndexCode": "0",
						"name": "ALMACEN KM18 NVR-2"
					},
					{
						"indexCode": "4",
						"parentIndexCode": "-1",
						"siteIndexCode": "0",
						"name": "ALMACEN KM18 NVR-3"
					},
					...More areas
				]
			},
			"headers": {
				"cache-control": "no-cache",
				"connection": "keep-alive",
				"content-encoding": "gzip",
				...More headers
			},
			"ok": true
		}
        */
        return areasResult;
    }
	
	const getArea = async (indexCode = '') => {
        if (! indexCode || ! ['string', 'number'].includes(typeof indexCode) || ('string' === typeof indexCode && ! indexCode.trim())) {
            return getInvalidIndexCodeObject();
        }

        params.area.body = JSON.stringify({regionIndexCode: indexCode.toString()});
        
        /*
        Returns an object like this one:
        {
            "res": {},
            "httpStatusCode": 200,
            "httpStatusText": "OK",
            "status": "success",
            "data": {
                "code": "0",
                "msg": "Success",
                "indexCode": "25",
                "parentIndexCode": "-1",
                "siteIndexCode": "0",
                "name": "Arroyo Gurabo Santiago"
            },
            "headers": {
                "cache-control": "no-cache",
                "connection": "keep-alive",
                "content-encoding": "gzip",
                ...More headers
            },
            "ok": true
        }
        */

        return await runFetch(apiServerUrl + endpoints.area, params.area, true);
    }
	
	const getIntegralCameraData = async (protocol = 'websocket') => {
        const protocols = ['rtsp', 'websocket', 'rtsp_s', 'websocket_s', 'hls', 'rtmp'];

        if (! protocol || 'string' != typeof protocol || ! protocol.trim() || ! protocols.includes(protocol.toLowerCase())) {
            return {
                status: 'fail',
                data: 'Invalid protocol'
            };
        }
        
        const [cameras, encodeDevices, areas] = await Promise.all([
            getCameras(),
            getEncodeDevices(),
            getAreas()
        ]);
        const camerasList = cameras?.data?.list;
        const cameraIndexCodesArr = [];

        if (camerasList?.length) {
            const cameraPromises = camerasList.map(async (c) => {
                const cameraIndexCode = c.cameraIndexCode;

                //We fill the array with cameraIndexCodes to get the preview URLs later
                cameraIndexCodesArr.push(cameraIndexCode);

                if (encodeDevices?.data?.list?.length) {
                    c.encodeDeviceInfo = encodeDevices.data.list.find(f => f?.encodeDevIndexCode && c?.encodeDevIndexCode && f.encodeDevIndexCode == c.encodeDevIndexCode) || {};
                }

                if (areas?.data?.list?.length) {
                    c.area = areas.data.list.find(f => f?.indexCode && c?.regionIndexCode && f.indexCode == c.regionIndexCode) || {};
                }

                if (c?.capabilitySet?.includes('ptz')) {
                    const [presets, patrols] = await Promise.all([
                        getPTZPresets(cameraIndexCode),
                        getPTZPatrols(cameraIndexCode)
                    ]);

                    c.presets = presets?.data?.list || [];
                    c.patrols = patrols?.data?.list || [];
                }

                return c;
            });

            await Promise.all(cameraPromises);

            const previewURLs = await getCamerasPreviewURLs(cameraIndexCodesArr.join(','), protocol, false);

            if (previewURLs?.data?.list && Object.keys(previewURLs.data.list)?.length) {
                camerasList.forEach((m) => {
                    if (m?.cameraIndexCode) {
                        m.mainStream = previewURLs.data.list?.[m.cameraIndexCode]?.mainStream || '';
                        m.subStream = previewURLs.data.list?.[m.cameraIndexCode]?.subStream || '';
                    }
                });
            }
        }

        /*
        Returns an object like this one:
        {
            "res": {},
            "httpStatusCode": 200,
            "httpStatusText": "OK",
            "status": "success",
            "data": {
                "code": "0",
                "msg": "Success",
                "total": 543,
                "pageNo": 1,
                "pageSize": 500,
                "list": [
                    {
                        "cameraIndexCode": "621",
                        "cameraName": " GARITA",
                        "capabilitySet": "event_pdc",
                        "devResourceType": "encodeDevice",
                        "encodeDevIndexCode": "81",
                        "recordType": "0",
                        "recordLocation": "1",
                        "regionIndexCode": "25",
                        "siteIndexCode": "0",
                        "status": 1,
                        "isSupportWakeUp": 0,
                        "wakeUpStatus": 0,
                        "encodeDeviceInfo": {
                            "encodeDevIndexCode": "81",
                            "encodeDevName": "Arroyo Gurabo Santiago",
                            "encodeDevIp": "10.100.63.200",
                            "encodeDevPort": "8000",
                            "encodeDevCode": "DS-9664NI-I81620220822CCRRK45226306WCVU",
                            "treatyType": "hiksdk_net",
                            "status": 1,
                            "isSupportWakeUp": 0,
                            "wakeUpStatus": -1,
                            "pictureStorePosType": 0
                        },
                        "area": {
                            "indexCode": "25",
                            "parentIndexCode": "-1",
                            "siteIndexCode": "0",
                            "name": "Arroyo Gurabo Santiago"
                        },
                        "mainStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55plbas%2FVVNGN5XFViDjJLyf5mSWDxbFzZPRkhxm%2BwFie4fejBr8hp0meWG0NPEqV%2FJvz1BefFDYlUMQkZ8fVMuQHLRwGSIehM%2F169k1nYFcG8JMow7SDi%2B590xyXHHoUgLAqUAeDE910SnBiGPs3lSbI8ejrkaYhr%2F51NI0ceXVAW2dy0TeTkFrDoVyBVLnEsWA%3D",
                        "subStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55plbas%2FVVNGN5XFViDjJLyf5mSWDxbFzZPRkhxm%2BwFie4fejBr8hp0meWG0NPEqV%2FJvz1BefFDYlUMQkZ8fVMuQHLRwGSIehM%2F169k1nYFcG8JMow7SDi%2B590xyXHHoUgLAqUAeDE910SnBiGPs3lSbI8ejrkaYhr%2F51NI0ceXVAW2dy0TeTkFrDoVyBVLnEsWA%3D"
                    },
                    {
                        "cameraIndexCode": "619",
                        "cameraName": " PARQUEO",
                        "capabilitySet": "event_pdc",
                        "devResourceType": "encodeDevice",
                        "encodeDevIndexCode": "81",
                        "recordType": "0",
                        "recordLocation": "1",
                        "regionIndexCode": "25",
                        "siteIndexCode": "0",
                        "status": 1,
                        "isSupportWakeUp": 0,
                        "wakeUpStatus": 0,
                        "encodeDeviceInfo": {
                            "encodeDevIndexCode": "81",
                            "encodeDevName": "Arroyo Gurabo Santiago",
                            "encodeDevIp": "10.100.63.200",
                            "encodeDevPort": "8000",
                            "encodeDevCode": "DS-9664NI-I81620220822CCRRK45226306WCVU",
                            "treatyType": "hiksdk_net",
                            "status": 1,
                            "isSupportWakeUp": 0,
                            "wakeUpStatus": -1,
                            "pictureStorePosType": 0
                        },
                        "area": {
                            "indexCode": "25",
                            "parentIndexCode": "-1",
                            "siteIndexCode": "0",
                            "name": "Arroyo Gurabo Santiago"
                        },
                        "mainStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55pngI35uWNl%2FcQ79V8%2F939Jw8Mz8wGCiyxejgmuJQRV91xNMxbujsvisvRKek3Em4ghamBsfijXEspB%2Bdofwis6147WZHk9qMuIAo1Yz6Azphfx5PgQ5ru%2Bc%2BA3QSycHOvs88SvOSts866cRjEGeCVVtc5oAMZ8rTlipTevZYviuEaQdgTvycW1zDawQ2sQ%2FgLA%3D",
                        "subStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55pngI35uWNl%2FcQ79V8%2F939Jw8Mz8wGCiyxejgmuJQRV91xNMxbujsvisvRKek3Em4ghamBsfijXEspB%2Bdofwis6147WZHk9qMuIAo1Yz6Azphfx5PgQ5ru%2Bc%2BA3QSycHOvs88SvOSts866cRjEGeCVVtc5oAMZ8rTlipTevZYviuEaQdgTvycW1zDawQ2sQ%2FgLA%3D"
                    },
                    {
                        "cameraIndexCode": "217",
                        "cameraName": "IPdome",
                        "capabilitySet": "ptz,event_pdc",
                        "devResourceType": "encodeDevice",
                        "encodeDevIndexCode": "4",
                        "recordType": "0",
                        "recordLocation": "1",
                        "regionIndexCode": "4",
                        "siteIndexCode": "0",
                        "status": 1,
                        "isSupportWakeUp": 0,
                        "wakeUpStatus": 0,
                        "encodeDeviceInfo": {
                            "encodeDevIndexCode": "4",
                            "encodeDevName": "ALMACEN KM18 NVR-3",
                            "encodeDevIp": "10.202.11.202",
                            "encodeDevPort": "8000",
                            "encodeDevCode": "DS-7716NI-I4/16P(B)1620220329CCRRJ72197730WCVU",
                            "treatyType": "hiksdk_net",
                            "status": 1,
                            "isSupportWakeUp": 0,
                            "wakeUpStatus": -1,
                            "pictureStorePosType": 0
                        },
                        "area": {
                            "indexCode": "4",
                            "parentIndexCode": "-1",
                            "siteIndexCode": "0",
                            "name": "ALMACEN KM18 NVR-3"
                        },
                        "presets": [
                            {
                                "presetName": "Preset 1",
                                "presetIndex": 1
                            },
                            {
                                "presetName": "Preset 2",
                                "presetIndex": 2
                            },
                            {
                                "presetName": "Preset 3",
                                "presetIndex": 3
                            }
                        ],
                        "patrols": [
                            {
                                "patrolName": "cruise1",
                                "patrolIndex": 1,
                                "PatrolPointInfo": {
                                    "presetIndex": 1,
                                    "speed": 4,
                                    "dwellTime": 15
                                }
                            }
                        ],
                        "mainStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55pngscEUDt%2FHCofIU%2FCzmDT128mz5%2FfI9JVOyTBU0an6BuVBxE0RQhd7PIOBPPHdPP%2FrCwqSDPSpnxl17W7G7kRtcpsYv%2FYI9cRjrHTYYsY9AAC735ZnwZHQoAraCAbdozVjdegaQvm%2BwaHUZ6BLtStTZrYHXW0u3Fxz%2Fs3skcPPJhrKxxmiNlToJPsFzRrCq6g%3D",
                        "subStream": "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55pngscEUDt%2FHCofIU%2FCzmDT128mz5%2FfI9JVOyTBU0an6BuVBxE0RQhd7PIOBPPHdPP%2FrCwqSDPSpnxl17W7G7kRtcpsYv%2FYI9cRjrHTYYsY9AAC735ZnwZHQoAraCAbdozVjdegaQvm%2BwaHUZ6BLtStTZrYHXW0u3Fxz%2Fs3skcPPJhrKxxmiNlToJPsFzRrCq6g%3D"
                    }
                ]
            },
            "headers": {
                "cache-control": "no-cache",
                "connection": "keep-alive",
                "content-encoding": "gzip",
                ...More headers
            },
            "ok": true
        }
        */
        return cameras;
    }
    
    const getIntegralSingleCameraData = async (indexCode = '', protocol = '') => {
		const camera = await getCamera(indexCode);
		
		if (camera?.data?.encodeDevIndexCode) {
			const ed = await getEncodeDevice(camera.data.encodeDevIndexCode);
			
            camera.data.encodeDeviceInfo = ed?.data || {};
		}
		
		if (camera?.data?.regionIndexCode) {
			const area = await getArea(camera.data.regionIndexCode);
			
            camera.data.area = area?.data || {};
		}
		
		if (camera?.data?.cameraIndexCode) {
			const urlData = await getCameraPreviewURL(camera.data.cameraIndexCode);
			
			camera.data.mainStream = urlData?.data?.mainStream || '';
            camera.data.subStream = urlData?.data?.subStream || '';
			
			const captureData = await getCameraCapture(camera.data.cameraIndexCode);
			
            camera.data.capture = captureData?.data?.data || '';
		}

        /*
        Returns an object like this one:
        {
            "res": {},
            "httpStatusCode": 200,
            "httpStatusText": "OK",
            "status": "success",
            "data": {
                "code": "0",
                "msg": "Success",
                "cameraIndexCode": "621",
                "cameraName": " GARITA",
                "capabilitySet": "event_pdc",
                "devResourceType": "encodeDevice",
                "cameraGuid": "A2179757AEE14A6BB248344C08650C2C",
                "encodeDevIndexCode": "81",
                "recordType": "0",
                "recordLocation": "1",
                "regionIndexCode": "25",
                "siteIndexCode": "0",
                "status": 1,
                "isSupportWakeUp": 0,
                "wakeUpStatus": 0,
                "encodeDeviceInfo": {
                    "code": "0",
                    "msg": "Success",
                    "encodeDevIndexCode": "81",
                    "encodeDevName": "Arroyo Gurabo Santiago",
                    "encodeDevIp": "10.100.63.200",
                    "encodeDevPort": "8000",
                    "encodeDevCode": "DS-9664NI-I81620220822CCRRK45226306WCVU",
                    "treatyType": "hiksdk_net",
                    "status": 1,
                    "isSupportWakeUp": 0,
                    "wakeUpStatus": -1,
                    "pictureStorePosType": 0,
                    "timeZone": {
                        "enableDST": 1,
                        "bias": 480,
                        "daylightBias": -60,
                        "daylightDate": "3:2:0:2:0",
                        "standardDate": "11:1:0:2:0"
                    }
                },
                "area": {
                    "code": "0",
                    "msg": "Success",
                    "indexCode": "25",
                    "parentIndexCode": "-1",
                    "siteIndexCode": "0",
                    "name": "Arroyo Gurabo Santiago"
                },
                mainStream: "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55plbas%2FVVNGN5XFViDjJLyf5mSWDxbFzZPRkhxm%2BwFie4fejBr8hp0meWG0NPEqV%2FJvz1BefFDYlUMQkZ8fVMuQHLRwGSIehM%2F169k1nYFcG8JMow7SDi%2B590xyXHHoUgLAqUAeDE910SnBiGPs3lSbI8ejrkaYhr%2F51NI0ceXVAW09xitFQXI1dvCQiclPkVL8%3D",
                subStream: "ws://172.20.2.99:559/sms/HCPEurl/commonvideobiz_gQcReZ%2BH2iVNJcuPLet%2BXcBJIjcLv5ji0VV3VBG55plbas%2FVVNGN5XFViDjJLyf5mSWDxbFzZPRkhxm%2BwFie4fejBr8hp0meWG0NPEqV%2FJvz1BefFDYlUMQkZ8fVMuQHLRwGSIehM%2F169k1nYFcG8JMow7SDi%2B590xyXHHoUgLAqUAeDE910SnBiGPs3lSbI8ejrkaYhr%2F51NI0ceXVAW09xitFQXI1dvCQiclPkVL8%3D",
                "capture": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wDFAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSgBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKAIHBwcKCAoTCgoTKBoWGigoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8AAEQgEOAeAAwEiAAIRAQMRAv/EAaIAAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKCxAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3/"
            },
            "headers": {
                "cache-control": "no-cache",
                "connection": "keep-alive",
                "content-encoding": "gzip",
                ...More headers
            },
            "ok": true
        }
        */
        return camera;
    }

    const testSomeEndpoints = async () => {
        await setParams();

        console.time();
        console.log('Version', await getHikcentralVersion());
        console.timeEnd();//159.177978515625 ms

        console.time();
        const cameras = await getCameras();
        console.log('Cameras', cameras);
        console.timeEnd();//4765.754150390625 ms
		
		console.time();
        console.log('Encode Devices', await getEncodeDevices());
        console.timeEnd();//67.159912109375 ms
		
		console.time();
        console.log('Areas', await getAreas());
        console.timeEnd();//48.4560546875 ms

        const firstCamera = await getCamera(cameras?.data?.list?.[0]?.cameraIndexCode);
        const secondCamera = await getCamera(cameras?.data?.list?.[1]?.cameraIndexCode);
		const ptzCamera = cameras.data.list.find(c => c?.capabilitySet?.includes('ptz'));
 
        if  (firstCamera?.data?.cameraIndexCode && secondCamera?.data?.cameraIndexCode) {
            const firstCameraIndexCode = firstCamera.data.cameraIndexCode;
            const secondCameraIndexCode = secondCamera.data.cameraIndexCode;	

			console.time();
            console.log('Camera', await getCamera(firstCameraIndexCode));
            console.timeEnd();//53.261962890625 ms
			
			if (cameras.data.list[0]?.encodeDevIndexCode) {
				console.time();
				console.log('Encode Device', await getEncodeDevice(cameras.data.list[0].encodeDevIndexCode));
				console.timeEnd();//53.891845703125 ms
			}
			
			if (cameras.data.list[0]?.regionIndexCode) {
				console.time();
				console.log('Area', await getArea(cameras.data.list[0].regionIndexCode));
				console.timeEnd();//47.029052734375 ms
			}
			
			console.time();
            console.log('Camera Status', await getCameraStatus(firstCameraIndexCode));
            console.timeEnd();//52.80908203125 ms
			
            console.time();
            console.log('Cameras Live URLs', await getCamerasPreviewURLs([firstCameraIndexCode, secondCameraIndexCode].join(',')));
            console.timeEnd();//49.845947265625 ms

            console.time();
            console.log('Camera Live URL', await getCameraPreviewURL(firstCameraIndexCode));
            console.timeEnd();//50.612060546875 ms

            console.time();
            console.log('Picture', await getCameraCapture(secondCameraIndexCode));
            console.timeEnd();//421.155029296875 ms
			
			console.time();
			console.log('Integral Single Camera Data', await getIntegralSingleCameraData(firstCameraIndexCode));
			console.timeEnd();//750.909912109375 ms
        }
		
		if (ptzCamera) {
			console.time();
			console.log('Presets', await getPTZPresets(217 || ptzCamera.cameraIndexCode));
			console.timeEnd();//45.637939453125 ms

			console.time();
			console.log('Patrols', await getPTZPatrols(217 || ptzCamera.cameraIndexCode));
			console.timeEnd();//42.30712890625 ms
		}
       
        console.time();
        console.log('Integral Data', await getIntegralCameraData());
        console.timeEnd();//7676.72607421875 ms
    }

    if (typeof module !== 'undefined' && module?.exports) {
        // Node.js module mode - export functions
        module.exports = {
            endpoints,
            runFetch,
            setParams,
            getHikcentralVersion,
            getEncodeDevices,
			getEncodeDevice,
            getCameras,
            getCamera,
            getCameraStatus,
            getCamerasPreviewURLs,
            getCameraPreviewURL,
            getCameraCapture,
            getPTZPresets,
            getPTZPatrols,
            controlPTZ,
            getAreas,
			getArea,
            getIntegralCameraData,
            getIntegralSingleCameraData
        };
    } else {
        testSomeEndpoints();
    }
})();