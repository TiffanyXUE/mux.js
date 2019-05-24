var StreamStates = {
    kReady: 0,
    kPrepared: 1,
    kPlaying: 2,
    kError: 3
};

var StreamPlayer = function( config ) {
    this.config_ = config;
    this.muxer_ = null;
    this.player_ = document.getElementById(config.el);
    this.state_ = 0;
    this.reader_ = null;
    this.stats_ = {
        ended: false,
        bytes: 0,
        packets: 0,
        pushed: 0,
        patCount: 0,
        segCount: 0,
        playCount: 0,
        bufferTimestamp: 0,
        emptyStreamTimestamp: 0
    };
    this.mediaInfo_ = null;
    this.mediaSource_ = null;
    this.dataSegments_ = null;
};

StreamPlayer.prototype._prepareMediaSource = function() {
    if( this.mediaSource_ ) {
        return;
    }
    var mse = new window.MediaSource();
    mse.addEventListener('sourceopen', this._onMediaSourceOpen.bind(this));
    mse.addEventListener('sourceclose', this._onMediaSourceClose.bind(this));
    // this.player_.muted = true;
    this.player_.src = URL.createObjectURL(mse);
    this.mediaSource_ = mse;
};

StreamPlayer.prototype._onMediaSourceOpen = function( ev ) {
    console.log('StreamPlayer: _onMediaSourceOpen');
    // 一旦连接到一起之后，该 URL object 就没用了，处于内存节省的目的，使用 URL.revokeObjectURL(src) 销毁指定的 URL object。
    URL.revokeObjectURL(this.player_.src);
    this.mediaSourceOpened_ = true;
};

StreamPlayer.prototype._onMediaSourceClose = function( ev ) {
    console.log('StreamPlayer: _onMediaSourceClose');
    this.mediaSourceOpened_ = false;
    
    var me = this;
    setTimeout(function(){
        if (me.state_ !== StreamStates.kPlaying) {
            me._onError.bind(me);
        }
    }, 1000);
};


StreamPlayer.prototype._padding = function( n, count ) {
    count = count || 2;
    var res = n.toString(16).toUpperCase();
    while( res.length < 2 ) {
        res = '0' + res;
    }
    return res;
};

StreamPlayer.prototype._addSourceBuffer = function( segment ) {
    var info = segment.info;
    if( !this.mediaSourceOpened_ ) {
        return;
    } else if( typeof(info.profileIdc) != 'number' || typeof(info.levelIdc) != 'number' ) {
        console.log('StreamPlayer: _addSourceBuffer with invalid segment info, ignored:', info);
        return;
    }
    
    var avcn = [info.profileIdc || 0x64, 0, info.levelIdc || 0x1f];
    var avcs = avcn.map(n => this._padding(n)).join('');
    var audioc = this.config_.audioc || 'mp4a.40.5';
    var muted = !this.muxer_.transmuxPipeline_.trackMap['audio'];
    var codec = this.config_.codec || ('avc1.' + avcs + (muted ? '' : (',' + audioc))); // 64001f
    var mime = 'video/mp4;codecs="' + codec + '"';
    var sourceBuffer = this.mediaSource_.addSourceBuffer(mime);
    sourceBuffer.addEventListener('updateend', this._onSourceBufferUpdated.bind(this));
    sourceBuffer.addEventListener('error', this._onSourceBufferError.bind(this));

    console.log('StreamPlayer: Add new source buffer, mime:', mime, info);
};

StreamPlayer.prototype._onSourceBufferUpdated = function( ev ) {
    // console.log('_onSourceBufferUpdated', ev, StreamStates.kPlaying);
    if( this.state_ < StreamStates.kPlaying ) {
        this.player_.play();
        this.state_ = StreamStates.kPlaying;
        this.stats_.playCount ++;
    }
    this._pushNextSegment();
};

StreamPlayer.prototype._onSourceBufferError = function( ev ) {
    // console.log('StreamPlayer: _onSourceBufferError', ev);
    this._onError(new Error('Source buffer error'));
};

StreamPlayer.prototype._prepareMuxer = function() {
    if( this.muxer_ ) {
        return;
    }
    var muxer = new muxjs.mp4.Transmuxer(this.config_.muxer || {});
    muxer.on('data', this._onMuxerData.bind(this));
    this.muxer_ = muxer;
    this.stats_.___time_chunk = new Date().getTime();
    this.stats_.___time_export = new Date().getTime();
    this.dataSegments_ = [];
};

StreamPlayer.prototype._onMuxerData = function( segment ) {
    // console.log('_onMuxerData', segment);
    // var parsed = muxjs.mp4.tools.inspect(segment.initSegment);
    // console.log('_onMuxerData parsed:', parsed);

    this.stats_.segCount ++;
    if( !segment.data || !segment.data.length ) {
        return;
    }
    var sourceBuffers = this.mediaSource_.sourceBuffers;
    segment.indivial = (sourceBuffers.length == 0);
    if( segment.indivial ) {
        var md = new Uint8Array(segment.initSegment.length + segment.data.length);
        md.set(segment.initSegment);
        md.set(segment.data, segment.initSegment.length);
        segment.mediaData = md;
    } else {
        segment.mediaData = segment.data;
    }

    this.dataSegments_.push(segment);
    if( !this.mediaInfo_ ) {
        this.mediaInfo_ = segment.info;
    }

    try {
        this._pushNextSegment();
    } catch( err ) {
        console.log('StreamPlayer: _pushNextSegment error:', err);
        this._onError(err);
    }
};

StreamPlayer.prototype._pushNextSegment = function() {
    if( this.dataSegments_.length == 0 ) {
        if( this.stats_.ended && this.mediaSource_ ) {
            this.mediaSource_.endOfStream();
            console.log('StreamPlayer: mediaSource_.endOfStream');
        }
        return;
    }
    var created = false;
    var segment = this.dataSegments_.shift();
    var sourceBuffers = this.mediaSource_.sourceBuffers;
    if( sourceBuffers.length == 0 || segment.indivial ) {
        created = true;
        this._addSourceBuffer(segment);
        if( sourceBuffers.length == 0 ) {
            return;
        }
    }

    var sourceBuffer = sourceBuffers[sourceBuffers.length - 1];
    if( !sourceBuffer.updating ) {
        var now = new Date();
        var dateStr = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}`;

        try {
            sourceBuffer.appendBuffer(segment.mediaData);
            if( sourceBuffer.buffered.length > 0 ) {
                var start = sourceBuffer.buffered.start(0),
                end = sourceBuffer.buffered.end(0);
                if (end === window.__preBufferedEnd && this.player_.currentTime === window.__prePlayTime) {
                    console.log('$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$', start, end, this.player_.currentTime);
                    if (!this.stats_.bufferTimestamp) this.stats_.bufferTimestamp = now.getTime();
                } else {
                    this.stats_.bufferTimestamp = 0;

                    if (this.player_.currentTime === window.__prePlayTime){
                        this.player_.currentTime = end-1;
                    }
                }

                // 2秒钟的bufferedEnd 相同，则删除一些buffered
                if (this.stats_.bufferTimestamp && now.getTime()-this.stats_.bufferTimestamp >= 2*1000) { 
                    if (sourceBuffer.updating) sourceBuffer.abort();
                    sourceBuffer.remove(start, start + (start + end) / 2);
                    this.player_.currentTime = end;
                }

                // 10秒钟bufferedEnd 相同，则重新播放
                if (this.stats_.bufferTimestamp && now.getTime()-this.stats_.bufferTimestamp >= 10*1000) { 
                    this.saveTA(segment.mediaData, 'error_'+dateStr+'_$$$$$$$$.f4m'); // 导出错误流用来调试
                    this._onError();
                }

                window.__preBufferedEnd = end;
                window.__prePlayTime = this.player_.currentTime;

                // // 查看mp4流
                // var parsed = muxjs.mp4.tools.inspect(segment.mediaData);
                // try {
                //     var baseMediaDecodeTime1 = parsed[0].boxes[1].boxes[1].baseMediaDecodeTime;
                //     var trackId1 = parsed[0].boxes[1].boxes[0].trackId;
                //     var baseMediaDecodeTime2 = parsed[2].boxes[1].boxes[1].baseMediaDecodeTime;
                //     var trackId2 = parsed[2].boxes[1].boxes[0].trackId;
                //     var nalLength1 = parsed[1].nals.length;
                //     var nalLength2 = parsed[3].nals.length;
                //     var infos = 
                //     [
                //         {trackId: trackId1, baseMediaDecodeTime: baseMediaDecodeTime1, nalLength: nalLength1},
                //         {trackId: trackId2, baseMediaDecodeTime: baseMediaDecodeTime2, nalLength: nalLength2},
                //     ];
                //     infos.sort(function(item1, item2){
                //         return item1.trackId - item2.trackId;
                //     });
                //     console.log(JSON.stringify(infos), start, end, this.player_.currentTime);
                // }
                // catch(e) {

                // }
            }

            // var tag = now.getTime() - this.stats_.___time_export > 60*60*1000; // 60分钟导出一个正常流
            // if (tag) {
            //     this.stats_.___time_export = now.getTime();
            //     this.saveTA(segment.mediaData, 'normal_'+dateStr+'.f4m');
            // }
        } catch (err) {
            this.saveTA(segment.mediaData, 'error_'+dateStr+'_'+err.message+'.f4m'); // 导出错误流用来调试
            if( sourceBuffer.buffered.length > 0 ) {
                var start = sourceBuffer.buffered.start(0),
                    end = sourceBuffer.buffered.end(0);
                console.log('TTTTTTTTTTTTTTTTTTTTTTTT', start, end, this.player_.currentTime);
            }
            this._onError(err);
        }
    } else {
        if( created ) {
            segment.indivial = false;
        }
        this.dataSegments_.unshift(segment);
    }
};

StreamPlayer.prototype.saveTA = function(tarr, n) {
    if (window.saveAs) {
        var b = new Blob([tarr], {
            type: 'application/octet-binary'
        });
        return window.saveAs(b, n);
    } eles {
        console.log('Save failed.', n);
    }
};

StreamPlayer.prototype._endOfStream = function() {
    this.stats_.ended = true;
    if( this.muxer_ ) {
        this.muxer_.flush();
    }
};

StreamPlayer.prototype._prepareReader = function() {
    if( this.reader_ ) {
        return;
    }

    var me = this;
    var params = this.config_.urlParams || {
        method: 'GET',
        mode: 'cors',
        cache: 'default',
        referrerPolicy: 'no-referrer-when-downgrade'
    };
    window.fetch(this.config_.url, params).then(function(res) {
        console.log('StreamPlayer: Response from:', me.config_.url, res.ok, res.status);
        me.reader_ = res.body.getReader();
        return me._pumpReader();
    }).catch(function( err ){
        console.log(`StreamPlayer: Fetch error:`, err);
        me._onError(err);
    });
};

StreamPlayer.prototype._pumpReader = function() {
    if( !this.reader_ ) {
        return;
    }

    var me = this;
    return this.reader_.read().then(function(result){
        var buffer = result && result.value ? result.value.buffer : null;
        var timestamp = new Date().getTime();
        if( !buffer ) {
            console.log('StreamPlayer: Reader stream end');
            if (!me.stats_.emptyStreamTimestamp) me.stats_.emptyStreamTimestamp = timestamp;
            // me._endOfStream();
            // return;
        } else {
            me.stats_.emptyStreamTimestamp = 0;
            // console.log(`Read:`, buffer.byteLength, ' bytes ...');
            me._assembleChunk(new Uint8Array(buffer));
        }

        // 连续5秒没有读取到数据流则重新播放
        if (me.stats_.emptyStreamTimestamp && timestamp-me.stats_.emptyStreamTimestamp >= 5*1000) { 
            me._onError();
        } else {
            setTimeout(function(){me._pumpReader();}, 0);
        }
    }).catch(function( err ){
        console.log(`StreamPlayer: Pump reader error:`, err);
        me._onError(err);
    });
};

StreamPlayer.prototype._assembleChunk = function( chunk ) {
    if( !this.muxer_ ) {
        return;
    }

    var tag = new Date().getTime() - this.stats_.___time_chunk > 0.1*1000; // 0.1秒flush一次
    if (tag) {
        this.stats_.___time_chunk = new Date().getTime();
        // console.log('0000000000000000000000000000 this.stats_.___time_chunk');

        try {
            this.muxer_.flush();
        } catch( err ) {
            console.log(`StreamPlayer: Muxer push and flush error:`, err);
        }
    }

    try {
        if (this.muxer_){
            this.muxer_.push(chunk);
            this.stats_.pushed += chunk.byteLength;
        }
    } catch( err ) {
        console.log(`StreamPlayer: Muxer push data error:`, err);
    }
};

StreamPlayer.prototype._doStop = function() {
    this.muxer_ = null;
    if( this.reader_ ) {
        this.reader_.cancel();
        this.reader_ = null;
    }
    if( this.mediaSource_ ) {
        try {
            this.mediaSource_.endOfStream();
            var sourceBuffers = this.mediaSource_.sourceBuffers;
            if( sourceBuffers && sourceBuffers.length > 0 ) {
                this.mediaSource_.removeSourceBuffer(sourceBuffers[0]);
            }
        } catch( err ) {
            // ignore
            console.log('StreamPlayer: End stream error:', err);
        }
        this.mediaSource_ = null;
        this.mediaSourceOpened_ = false;
    }
    if( this.player_ ) {
        try {
            this.player_.pause();
        } catch( err ) {
            // ignore
            console.log('StreamPlayer: Pause player error:', err);
        }
        URL.revokeObjectURL(this.player_.src);
        this.player_.removeAttribute('src');
        this.player_.load();
    }
    this.state_ = StreamStates.kReady;
    this.stats_.patCount = 0;
    this.stats_.segCount = 0;
};

StreamPlayer.prototype._onError = function( err ) {
    if (err) {
        console.log('StreamPlayer: _onError:', this.state_, this.stats_.playCount, err);
    }
    var retryInterval = this.config_.retryInterval || 1000;
    this._doStop();
    if( this.config_.retry !== false && this.stats_.playCount > 0 ) {
        console.log('StreamPlayer: Retry play on error during playing');
        setTimeout(this.play.bind(this), retryInterval);
    }

    setTimeout((function(){
        if (!this.mediaSourceOpened_) {
            this._doStop();
            if( this.config_.retry !== false && this.stats_.playCount > 0 ) {
                console.log('StreamPlayer: Retry play on error during playing');
                setTimeout(this.play.bind(this), retryInterval);
            } 
        }
    }).bind(this), 1000);
};

StreamPlayer.prototype.play = function() {
    if( this.state_ > StreamStates.kReady ) {
        return;
    }

    console.log('StreamPlayer: Start play', this.config_);

    this._prepareMuxer();
    this._prepareReader();
    this._prepareMediaSource();
    this.stats_.ended = false;
    this.state_ = StreamStates.kPrepared;
};

StreamPlayer.prototype.stop = function() {
    this._doStop();
};

StreamPlayer.prototype.state = function() {
    return this.state_;
};

StreamPlayer.prototype.stats = function() {
    return this.stats_;
};

