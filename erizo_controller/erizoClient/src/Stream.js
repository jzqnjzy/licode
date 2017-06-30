/* global L, document, Erizo*/
this.Erizo = this.Erizo || {};

/*
 * Class Stream represents a local or a remote Stream in the Room. It will handle the WebRTC
 * stream and identify the stream and where it should be drawn.
 */
Erizo.Stream = (specInput) => {
  const spec = specInput;
  const that = Erizo.EventDispatcher(spec);

  that.stream = spec.stream;
  that.url = spec.url;
  that.recording = spec.recording;
  that.room = undefined;
  that.showing = false;
  that.local = false;
  that.video = spec.video;
  that.audio = spec.audio;
  that.screen = spec.screen;
  that.videoSize = spec.videoSize;
  that.videoFrameRate = spec.videoFrameRate;
  that.extensionId = spec.extensionId;
  that.desktopStreamId = spec.desktopStreamId;
  that.audioMuted = false;
  that.videoMuted = false;

  if (that.videoSize !== undefined &&
        (!(that.videoSize instanceof Array) ||
           that.videoSize.length !== 4)) {
    throw Error('Invalid Video Size');
  }
  if (spec.local === undefined || spec.local === true) {
    that.local = true;
  }

  // Public functions
  that.getID = () => {
    let id;
    // Unpublished local streams don't yet have an ID.
    if (that.local && !spec.streamID) {
      id = 'local';
    } else {
      id = spec.streamID;
    }
    return id;
  };

  // Get attributes of this stream.
  that.getAttributes = () => spec.attributes;

  // Changes the attributes of this stream in the room.
  that.setAttributes = (attrs) => {
    if (that.local) {
      that.emit(Erizo.StreamEvent({ type: 'internal-set-attributes', stream: that, attrs }));
      return;
    }
    L.Logger.error('Failed to set attributes data. This Stream object has not been published.');
  };

  that.updateLocalAttributes = (attrs) => {
    spec.attributes = attrs;
  };

  // Indicates if the stream has audio activated
  that.hasAudio = () => spec.audio;

  // Indicates if the stream has video activated
  that.hasVideo = () => spec.video;

  // Indicates if the stream has data activated
  that.hasData = () => spec.data;

  // Indicates if the stream has screen activated
  that.hasScreen = () => spec.screen;

  that.hasMedia = () => spec.audio || spec.video || spec.screen;

  that.isExternal = () => that.url !== undefined || that.recording !== undefined;

  // Sends data through this stream.
  that.sendData = (msg) => {
    if (that.local && that.hasData()) {
      that.emit(Erizo.StreamEvent({ type: 'internal-send-data', stream: that, msg }));
      return;
    }
    L.Logger.error('Failed to send data. This Stream object has not been published.');
  };

  // Initializes the stream and tries to retrieve a stream from local video and audio
  // We need to call this method before we can publish it in the room.
  that.init = () => {
    try {
      if ((spec.audio || spec.video || spec.screen) && spec.url === undefined) {
        L.Logger.info('Requested access to local media');
        let videoOpt = spec.video;
        if (videoOpt === true || spec.screen === true) {
          videoOpt = videoOpt === true ? {} : videoOpt;
          if (that.videoSize !== undefined) {
            videoOpt.mandatory = videoOpt.mandatory || {};
            videoOpt.mandatory.minWidth = that.videoSize[0];
            videoOpt.mandatory.minHeight = that.videoSize[1];
            videoOpt.mandatory.maxWidth = that.videoSize[2];
            videoOpt.mandatory.maxHeight = that.videoSize[3];
          }

          if (that.videoFrameRate !== undefined) {
            videoOpt.optional = videoOpt.optional || [];
            videoOpt.optional.push({ minFrameRate: that.videoFrameRate[0] });
            videoOpt.optional.push({ maxFrameRate: that.videoFrameRate[1] });
          }
        } else if (spec.screen === true && videoOpt === undefined) {
          videoOpt = true;
        }
        const opt = { video: videoOpt,
          audio: spec.audio,
          fake: spec.fake,
          screen: spec.screen,
          extensionId: that.extensionId,
          desktopStreamId: that.desktopStreamId };
        Erizo.GetUserMedia(opt, (stream) => {
            // navigator.webkitGetUserMedia("audio, video", (stream) => {

          L.Logger.info('User has granted access to local media.');
          that.stream = stream;

          that.dispatchEvent(Erizo.StreamEvent({ type: 'access-accepted' }));

          that.stream.getTracks().forEach((trackInput) => {
            const track = trackInput;
            track.onended = () => {
              that.stream.getTracks().forEach((secondTrackInput) => {
                const secondTrack = secondTrackInput;
                secondTrack.onended = null;
              });
              const streamEvent = Erizo.StreamEvent({ type: 'stream-ended',
                stream: that,
                msg: track.kind });
              that.dispatchEvent(streamEvent);
            };
          });
        }, (error) => {
          L.Logger.error(`Failed to get access to local media. Error code was ${
                           error.code}.`);
          const streamEvent = Erizo.StreamEvent({ type: 'access-denied', msg: error });
          that.dispatchEvent(streamEvent);
        });
      } else {
        const streamEvent = Erizo.StreamEvent({ type: 'access-accepted' });
        that.dispatchEvent(streamEvent);
      }
    } catch (e) {
      L.Logger.error(`Failed to get access to local media. Error was ${e}.`);
      const streamEvent = Erizo.StreamEvent({ type: 'access-denied', msg: e });
      that.dispatchEvent(streamEvent);
    }
  };


  that.close = () => {
    if (that.local) {
      if (that.room !== undefined) {
        that.room.unpublish(that);
      }
      // Remove HTML element
      that.hide();
      if (that.stream !== undefined) {
        that.stream.getTracks().forEach((trackInput) => {
          const track = trackInput;
          track.onended = null;
          track.stop();
        });
      }
      that.stream = undefined;
    }
  };

  that.play = (elementID, optionsInput) => {
    const options = optionsInput || {};
    that.elementID = elementID;
    let player;
    if (that.hasVideo() || this.hasScreen()) {
      // Draw on HTML
      if (elementID !== undefined) {
        player = Erizo.VideoPlayer({ id: that.getID(),
          stream: that,
          elementID,
          options });
        that.player = player;
        that.showing = true;
      }
    } else if (that.hasAudio) {
      player = Erizo.AudioPlayer({ id: that.getID(),
        stream: that,
        elementID,
        options });
      that.player = player;
      that.showing = true;
    }
  };

  that.stop = () => {
    if (that.showing) {
      if (that.player !== undefined) {
        that.player.destroy();
        that.showing = false;
      }
    }
  };

  that.show = that.play;
  that.hide = that.stop;

  const getFrame = () => {
    if (that.player !== undefined && that.stream !== undefined) {
      const video = that.player.video;
      const style = document.defaultView.getComputedStyle(video);
      const width = parseInt(style.getPropertyValue('width'), 10);
      const height = parseInt(style.getPropertyValue('height'), 10);
      const left = parseInt(style.getPropertyValue('left'), 10);
      const top = parseInt(style.getPropertyValue('top'), 10);

      let div;
      if (typeof that.elementID === 'object' &&
              typeof that.elementID.appendChild === 'function') {
        div = that.elementID;
      } else {
        div = document.getElementById(that.elementID);
      }

      const divStyle = document.defaultView.getComputedStyle(div);
      const divWidth = parseInt(divStyle.getPropertyValue('width'), 10);
      const divHeight = parseInt(divStyle.getPropertyValue('height'), 10);
      const canvas = document.createElement('canvas');

      canvas.id = 'testing';
      canvas.width = divWidth;
      canvas.height = divHeight;
      canvas.setAttribute('style', 'display: none');
      // document.body.appendChild(canvas);
      const context = canvas.getContext('2d');

      context.drawImage(video, left, top, width, height);

      return canvas;
    }
    return null;
  };

  that.getVideoFrameURL = (format) => {
    const canvas = getFrame();
    if (canvas !== null) {
      if (format) {
        return canvas.toDataURL(format);
      }
      return canvas.toDataURL();
    }
    return null;
  };

  that.getVideoFrame = () => {
    const canvas = getFrame();
    if (canvas !== null) {
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    }
    return null;
  };

  that.checkOptions = (configInput, isUpdate) => {
    const config = configInput;
    // TODO: Check for any incompatible options
    if (isUpdate === true) {  // We are updating the stream
      if (config.video || config.audio || config.screen) {
        L.Logger.warning('Cannot update type of subscription');
        config.video = undefined;
        config.audio = undefined;
        config.screen = undefined;
      }
    } else if (that.local === false) { // check what we can subscribe to
      if (config.video === true && that.hasVideo() === false) {
        L.Logger.warning('Trying to subscribe to video when there is no ' +
                                   'video, won\'t subscribe to video');
        config.video = false;
      }
      if (config.audio === true && that.hasAudio() === false) {
        L.Logger.warning('Trying to subscribe to audio when there is no ' +
                                   'audio, won\'t subscribe to audio');
        config.audio = false;
      }
    }
    if (that.local === false) {
      if (!that.hasVideo() && (config.slideShowMode === true)) {
        L.Logger.warning('Cannot enable slideShowMode if it is not a video ' +
                                 'subscription, please check your parameters');
        config.slideShowMode = false;
      }
    }
  };

  const muteStream = (callback) => {
    if (that.room && that.room.p2p) {
      L.Logger.warning('muteAudio/muteVideo are not implemented in p2p streams');
      callback('error');
      return;
    }
    if (that.stream) {
      for (let index = 0; index < that.stream.getVideoTracks().length; index += 1) {
        const track = that.stream.getVideoTracks()[index];
        track.enabled = !that.videoMuted;
      }
    }
    const config = { muteStream: { audio: that.audioMuted, video: that.videoMuted } };
    that.checkOptions(config, true);
    that.pc.updateSpec(config, callback);
  };

  that.muteAudio = (isMuted, callback) => {
    that.audioMuted = isMuted;
    muteStream(callback);
  };

  that.muteVideo = (isMuted, callback) => {
    that.videoMuted = isMuted;
    muteStream(callback);
  };

  // eslint-disable-next-line no-underscore-dangle
  that._setQualityLayer = (spatialLayer, temporalLayer, callback) => {
    if (that.room && that.room.p2p) {
      L.Logger.warning('setQualityLayer is not implemented in p2p streams');
      callback('error');
      return;
    }
    const config = { qualityLayer: { spatialLayer, temporalLayer } };
    that.checkOptions(config, true);
    that.pc.updateSpec(config, callback);
  };

  const controlHandler = (handlersInput, publisherSideInput, enable) => {
    let publisherSide = publisherSideInput;
    let handlers = handlersInput;
    if (publisherSide !== true) {
      publisherSide = false;
    }

    handlers = (typeof handlers === 'string') ? [handlers] : handlers;
    handlers = (handlers instanceof Array) ? handlers : [];

    if (handlers.length > 0) {
      that.room.sendControlMessage(that, 'control', { name: 'controlhandlers',
        enable,
        publisherSide,
        handlers });
    }
  };

  that.disableHandlers = (handlers, publisherSide) => {
    controlHandler(handlers, publisherSide, false);
  };

  that.enableHandlers = (handlers, publisherSide) => {
    controlHandler(handlers, publisherSide, true);
  };

  that.updateConfiguration = (config, callback) => {
    if (config === undefined) { return; }
    if (that.pc) {
      that.checkOptions(config, true);
      if (that.local) {
        if (that.room.p2p) {
          for (let index = 0; index < that.pc.length; index += 1) {
            that.pc[index].updateSpec(config, callback);
          }
        } else {
          that.pc.updateSpec(config, callback);
        }
      } else {
        that.pc.updateSpec(config, callback);
      }
    } else {
      callback('This stream has no peerConnection attached, ignoring');
    }
  };

  return that;
};
