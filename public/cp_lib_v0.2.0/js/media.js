(function() {
    "use strict;"

    if (! navigator?.mediaDevices || ! navigator?.mediaDevices?.enumerateDevices) {
        const protocolError = 'http:' == window.location.protocol ? ' Be aware that using protocol http instead of https (with the exception of local development enviroments) may cause your browser to block access the microphone and webcam.' : '';

        console.warn(`getUserMedia() is not supported in your browser.${protocolError}`);
    } else {
        //Nomalizamos algunos objetos del navegador
        if (! navigator?.mediaDevices?.getUserMedia) {
            navigator.mediaDevices.getUserMedia = navigator.getUserMedia ||  navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
        }
    }

    window.AudioContext = window.AudioContext || window.webkitAudioContext || window.mozAudioContext || window.msAudioContext;

    const getMediaDevices = (removeDuplicates = false) => {
        return new Promise(async (resolve) => {
            const devicesList = await navigator.mediaDevices.enumerateDevices();
            const devices = {
                speakers: [],
                mics: [],
                webcams: [],
                speaker: false,
                loudSpeaker: false
            };

            for (const device of devicesList) {
                if ('audiooutput' == device.kind) {
                    devices.speakers.push(device);

                    //OJO: Solo detectaría en sistemas en Inglés y Español, aunque puede que detecte erroneamente si hay mas de un dispositivo con estas características
                    if (device?.deviceId) {
                        //OJO: Solo detectaría en sistemas en Inglés y Español, aunque puede que detecte erroneamente si hay mas de un dispositivo con estas características
                        if (device?.label && (device.label.indexOf('ltavoc') + 1 || device.label.indexOf('speaker') + 1)) {
                            devices.loudSpeaker = device.deviceId;
                        } else {
                            if (! devices.speaker) { devices.speaker = device.deviceId; }
                        }
                    }
                }
                if ('audioinput' == device.kind) { devices.mics.push(device); }
                if ('videoinput' == device.kind) { devices.webcams.push(device); }
            }

            if (removeDuplicates) {
                const removeDuplicateDevices = (deviceList) => {
                    const devicesGroupIds = [];
                    const devicesTemp = [];
    
                    for (let d = 0; d < deviceList.length; d++) {
                        devicesGroupIds.push((devicesGroupIds.indexOf(deviceList[d].groupId) > -1) ? false : deviceList[d].groupId);
                    }

                    for (let d = 0; d < devicesGroupIds.length; d++) {
                        if (devicesGroupIds[d]) { devicesTemp.push(deviceList[d]); }
                    }
    
                    return devicesTemp;
                }

                devices.mics = removeDuplicateDevices(devices.mics);
                devices.speakers = removeDuplicateDevices(devices.speakers);
                devices.webcams = removeDuplicateDevices(devices.webcams);
            }

            return resolve(devices);
        });
    }
    
    const getMediaConstrains = (micId = 'default', webcamId = 'default') => {
        return new Promise(async (resolve) => {
            const devices = await getMediaDevices();
            const constraints = {
                audio: false,
                video: false
            };

            if (devices?.mics && devices.mics[0]) {
                for (const mic of devices.mics) {
                    if (mic?.deviceId == micId) {
                        constraints.audio = {};
                        constraints.audio.deviceId = {exact: micId};
                    }
                }

                if (! constraints.audio?.deviceId) { constraints.audio = true; }
            }

            if (devices?.webcams && devices.webcams[0]) {
                for (const webcam of devices.webcams) {
                    if (webcam?.deviceId == webcamId) {
                        constraints.video = {};
                        constraints.video.deviceId = {exact: webcamId};
                    }
                }

                if (! constraints.video?.deviceId) { constraints.video = true; }
            }

            if (constraints?.audio?.deviceId || constraints.video?.deviceId) {
                //OJO: Esto hay que analizarlo bien
                //aspectRatio, autoGainControl, brightness, channelCount, colorTemperature, contrast, deviceId, displaySurface, echoCancellation, exposureCompensation, 
                //exposureMode, exposureTime, facingMode, focusDistance, focusMode, frameRate, groupId, height, iso, latency, noiseSuppression, pan, pointsOfInterest, 
                //resizeMode, sampleRate, sampleSize, saturation, suppressLocalAudioPlayback, tilt, torch, whiteBalanceMode, width, zoom
                const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
                for (const [cscName, cscValue] of Object.entries(supportedConstraints)) {
                    if (cscName == 'autoGainControl' || cscName == 'echoCancellation' || cscName == 'noiseSuppression') { constraints.audio[cscName] = cscValue; }
                }
            }

            return resolve(constraints);
        });
    }

    const getMediaStream = (constraints = {}) => {
        return new Promise(async (resolve) => {
            if (! constraints) {
                constraints = await getMediaConstrains();
            } else {
                //No se que hace este bloque y tampoco sé que hace el !0
                if (! constraints?.audio) { constraints['audio'] = !0; }
            }

            //https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
            try {
                const mediaStream = navigator.mediaDevices.getUserMedia(constraints);

                //De esta forma creo que puede extraer solo el audio, no se si tanto de micrófonos como de videos
                //const micsStreams = new MediaStream();

                //mediaStream.getAudioTracks().forEach((track) => { micsStreams.addTrack(track); });

                //return resolve(micsStreams);

                return resolve(mediaStream);
            } catch (err) {
                console.warn('navigator.getUserMedia has been rejected by the user', err);

                return resolve(false);
            }
        });
    }

    const getSoundAnalyser = (stream, size = 64) => {
        const ac = new AudioContext();
        const analyser = new AnalyserNode(ac);
        const acMediaStreamSource = ac.createMediaStreamSource(stream);

        acMediaStreamSource.connect(analyser);
        
        //https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/fftSize
        //Fast Fourier Transform (FFT) to get frequency domain data
        //Must be a power of 2 between 2^5 and 2^15, so one of: 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, and 32768. Defaults to 2048.
        analyser.fftSize = size;
        //For technical reasons related to how the Fast Fourier transform is defined, it is always half the value of AnalyserNode.fftSize.
        //Therefore, it will be one of 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, and 16384
        const dataArray = new Uint8Array(analyser.frequencyBinCount);//analyser.frequencyBinCount es la mitad del tamaño del Fast Fourier Transform

        //analyser.getByteFrequencyData(dataArray);//Populate array with data from 0-255

        return {analyser: analyser, dataArray: dataArray};
    }

    const functionList = [getMediaDevices, getMediaConstrains, getMediaStream, getSoundAnalyser];

    functionList.forEach((n) => { __CPLIB__[n.name] = n; });
})();