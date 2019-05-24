'use strict';
var
	$ = document.querySelector.bind(document),
	inputs = $('#inputs'),
	original = $('#original'),
	working = $('#working'),
	saveButton = $('#save-muxed'),

	vjsParsed,
	workingParsed,
	diffParsed,
	vjsBytes,
	workingBytes,
	saveConfig,
	restoreConfig,
	saveTA,

	vjsBoxes = $('.vjs-boxes'),
	workingBoxes = $('.working-boxes'),
	workingBoxes = $('.working-boxes'),

	muxedData,
	muxedName,
	transmuxer,
	video,
	mediaSource,
	logevent,
	prepareSourceBuffer;

logevent = function(event) {
	console.log(event.type);
};

saveTA = function(tarr, n) {
	var b = new Blob([tarr], {
		type: 'application/octet-binary'
	});
	return window.saveAs(b, n);
};

saveConfig = function() {
	var inputs = [].slice.call(document.querySelectorAll('input:not([type=file])'));

	inputs.forEach(function(element) {
		localStorage.setItem(element.id,
			JSON.stringify({
				value: element.value,
				checked: element.checked,
				disabled: element.disabled
			}));
	});
};

restoreConfig = function() {
	var inputs = [].slice.call(document.querySelectorAll('input:not([type=file])'));

	inputs.forEach(function(element) {
		var state;

		state = JSON.parse(localStorage.getItem(element.id));
		if (state) {
			element.checked = state.checked;
			element.value = state.value;
			element.disabled = state.disabled;
		}
	});
};
document.addEventListener('DOMContentLoaded', restoreConfig);

// output a diff of the two parsed MP4s
diffParsed = function() {
	var comparison, diff, transmuxed;
	if (!vjsParsed || !workingParsed) {
		// wait until both inputs have been provided
		return;
	}
	comparison = $('#comparison');
	transmuxed = vjsParsed;
	diff = '<p>A <del>red background</del> indicates ' +
		'properties present in the transmuxed file but missing from the ' +
		'working version. A <ins>green background</ins> indicates ' +
		'properties present in the working version but missing in the ' +
		'transmuxed output.</p>';
	diff += '<pre class="mp4-diff">' +
		QUnit.diff(muxjs.mp4.tools.textify(transmuxed, null, ' '),
			muxjs.mp4.tools.textify(workingParsed, null, ' ')) +
		'</pre>';

	comparison.innerHTML = diff;
};

prepareSourceBuffer = function(combined, outputType, callback) {
	var
		buffer,
		codecs,
		codecsArray,
		resetTransmuxer = $('#reset-tranmsuxer').checked;

	if (typeof combined === 'function') {
		callback = combined;
		combined = true;
	}

	// Our work here is done if the sourcebuffer has already been created
	if (!resetTransmuxer && window.vjsBuffer) {
		return callback();
	}

	video = document.createElement('video');
	video.controls = true;
	mediaSource = new MediaSource();
	video.src = URL.createObjectURL(mediaSource);
	window.vjsVideo = video;
	window.vjsMediaSource = mediaSource;
	$('#video-place').innerHTML = '';
	$('#video-place').appendChild(video);

	mediaSource.addEventListener('error', logevent);
	mediaSource.addEventListener('opened', logevent);
	mediaSource.addEventListener('closed', logevent);
	mediaSource.addEventListener('sourceended', logevent);

	codecs = $('#codecs');
	codecsArray = codecs.value.split(',');

	mediaSource.addEventListener('sourceopen', function() {
		mediaSource.duration = 0;
		if (combined) {
			buffer = mediaSource.addSourceBuffer('video/mp4;codecs="' + codecs.value + '"');
		} else if (outputType === 'video') {
			buffer = mediaSource.addSourceBuffer('video/mp4;codecs="' + codecsArray[0] + '"');
		} else if (outputType === 'audio') {
			buffer = mediaSource.addSourceBuffer('audio/mp4;codecs="' + (codecsArray[1] || codecsArray[0]) + '"');
		}

		buffer.addEventListener('updatestart', logevent);
		buffer.addEventListener('updateend', logevent);
		buffer.addEventListener('error', logevent);
		window.vjsBuffer = buffer;

		video.addEventListener('error', logevent);
		video.addEventListener('error', function() {
			document.getElementById('video-place').classList.add('error');
		});

		return callback();
	});
};

original.addEventListener('change', function() {
	var reader = new FileReader();

	// do nothing if no file was chosen
	if (!this.files[0]) {
		return;
	}

	reader.addEventListener('loadend', function() {

		var segment = new Uint8Array(reader.result),
			combined = document.querySelector('#combined-output').checked,
			outputType = document.querySelector('input[name="output"]:checked').value,
			resetTransmuxer = $('#reset-tranmsuxer').checked,
			remuxedSegments = [],
			remuxedInitSegment = null,
			remuxedBytesLength = 0,
			createInitSegment = false,
			bytes,
			i, j;

		if (resetTransmuxer || !transmuxer) {
			createInitSegment = true;
			if (combined) {
				outputType = 'combined';
				transmuxer = new muxjs.mp4.Transmuxer();
			} else {
				transmuxer = new muxjs.mp4.Transmuxer({
					remux: false
				});
			}

			transmuxer.on('data', function(event) {
				if (event.type === outputType) {
					remuxedSegments.push(event);
					remuxedBytesLength += event.data.byteLength;
					remuxedInitSegment = event.initSegment;
				}
			});

			transmuxer.on('done', function() {
				var offset = 0;
				if (createInitSegment) {
					bytes = new Uint8Array(remuxedInitSegment.byteLength + remuxedBytesLength)
					bytes.set(remuxedInitSegment, offset);
					offset += remuxedInitSegment.byteLength;
					createInitSegment = false;
				} else {
					bytes = new Uint8Array(remuxedBytesLength);
				}

				for (j = 0, i = offset; j < remuxedSegments.length; j++) {
					bytes.set(remuxedSegments[j].data, i);
					i += remuxedSegments[j].byteLength;
				}
				muxedData = bytes;
				remuxedSegments = [];
				remuxedBytesLength = 0;

				vjsBytes = bytes;
				vjsParsed = muxjs.mp4.tools.inspect(bytes);
				console.log('transmuxed', vjsParsed);
				diffParsed();

				// clear old box info
				vjsBoxes.innerHTML = muxjs.mp4.tools.textify(vjsParsed, null, ' ');

				if ($('#original-active').checked) {
					prepareSourceBuffer(combined, outputType, function() {
						console.log('appending...');
						window.vjsBuffer.appendBuffer(bytes);
						video.play();
					});
				}
			});
		}

		transmuxer.push(segment);
		transmuxer.flush();
	});

	muxedName = this.files[0].name.replace('.ts', '.f4m');
	reader.readAsArrayBuffer(this.files[0]);
}, false);

working.addEventListener('change', function() {
	var reader = new FileReader();

	reader.addEventListener('loadend', function() {
		var bytes = new Uint8Array(reader.result);

		if ($('#working-active').checked) {
			prepareSourceBuffer(function() {
				window.vjsBuffer.appendBuffer(bytes);
				video.play();
			});
		}

		workingBytes = bytes;
		workingParsed = muxjs.mp4.tools.inspect(bytes);
		console.log('working', workingParsed);
		diffParsed();

		// clear old box info
		workingBoxes.innerHTML = muxjs.mp4.tools.textify(workingParsed, null, ' ');
	});
	reader.readAsArrayBuffer(this.files[0]);
}, false);


$('#save-muxed').addEventListener('click', function() {
	if (muxedData && muxedName) {
		return saveTA(muxedData, muxedName);
	}
});

$('#combined-output').addEventListener('change', function() {
	Array.prototype.slice.call(document.querySelectorAll('[name="output"'))
		.forEach(function(el) {
			el.disabled = this.checked;
		}, this);
});

[].slice.call(document.querySelectorAll('input')).forEach(function(el) {
	el.addEventListener('change', saveConfig);
});