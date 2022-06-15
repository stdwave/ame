/*******************************************************************************
detect OS:Macintosh / Windows
*******************************************************************************/
var nameOS;
if(navigator.userAgent.indexOf("Windows") != -1) nameOS = 'Windows';
else if(navigator.userAgent.indexOf("Macintosh") != -1) nameOS = 'Mac';
else nameOS = 'noSupportedOS';

/*******************************************************************************
detect Browswr: Safari / Chrome / Firefox
*******************************************************************************/
var nameBrowser;
if(navigator.userAgent.indexOf("Chrome") != -1 && navigator.userAgent.indexOf("Edge") == -1){
	nameBrowser = 'Chrome';
}else if(navigator.userAgent.indexOf("Safari") != -1 && navigator.userAgent.indexOf("Edge") == -1){
	nameBrowser = 'Safari';
}else if(navigator.userAgent.indexOf("Firefox") != -1){
	nameBrowser = 'Firefox';
}else{
	nameBrowser = 'noSupportedBrowser';
}
// console.log('OS:' + nameOS + ' Brosewr:' + nameBrowser);

/*******************************************************************************
dipslay no supported Message / initialize for supported browser
*******************************************************************************/
if( nameOS === 'noSupportedOS' || nameBrowser === 'noSupportedBrowser'){				//no supported browsewr or OS
	document.getElementById('divChkBrowsOS').style.display = 'block';
	document.getElementById('divSprtBrows').style.display = 'block';
}else{																																					//supported browsers or OS
	/*============================================================================
	Loading proc
	============================================================================*/
	document.getElementById('divLoadSeq').style.display = 'block';

	var numSongFiles = objCombProc.songfiles.length;	//num of song files
	//set each sounds
	sounds = new Array(numSongFiles + 1);							//'+1' is output ch.
	//for Output Ch.
	sounds[numSongFiles] = new Sound();
	sounds[numSongFiles].init('OUTPUT');
	sounds[numSongFiles].outputDestination(context.destination);
	//for Part Ch.
	var dirExt = objCombProc.getAudioDirExt();
	var dir = dirExt.dir;
	var ext = dirExt.ext;
	for(var i=0, len=numSongFiles; i<len; i++){
		sounds[i] = new Sound();
	 	sounds[i].init(objCombProc.songfiles[i][0], objCombProc.songfiles[i][1]);
	 	sounds[i].outputDestination(sounds[numSongFiles].gainNodeInput);
		//loadBuffer(dir+sounds[i].name+ext, i);				//load audio file
	};

	/*============================================================================
	Combination process
	============================================================================*/
	objCombProc.init();
	objTranspose.init();
	objInspector.init();
	objTrack.init();
	objMixer.init();
	objEQ.init();
	objComp.init();
	objFX.init();
	objNavi.init();

	/*============================================================================
	Cross browser
	============================================================================*/
	// var lnkAmeCSS= document.getElementById('lnkAmeCSS');
	// if(nameOS === 'Mac' && nameBrowser === 'Firefox'){
	// 	objTrack.setIsBlurToTrack();												//<select> in Track
	// 	objFX.setIsBlurToFX();															//<select> in FX
	// 	objEQ.setIsBlurToEQ();															//<select> in EQ
	// }else if(nameOS === 'Mac' && nameBrowser === 'Safari'){
	// 	lnkAmeCSS.href = 'css/ameMacSafari.css';
	// 	objCombProc.setOutputChEqCompParamForMacSafari();		//for booming sound
	// 	objNavi.setBorderForMacSafari();										//for menu 
	// 	objNavi.useMsgForMacSafari();												//for openning message
	// }else if(nameOS === 'Mac' && nameBrowser === 'Chrome'){
	// 	lnkAmeCSS.href = 'css/ameMacChrome.css';
	// }else if(nameOS === 'Windows' && nameBrowser === 'Firefox'){
	// 	lnkAmeCSS.href = 'css/ameWinFirefox.css';
	// }else if(nameOS === 'Windows' && nameBrowser === 'Chrome'){
	// 	lnkAmeCSS.href = 'css/ameWinChrome.css';
	// }

	/*============================================================================
	display Notice
	============================================================================*/
	objNavi.dispOpening();

	/*============================================================================
	Worker
	============================================================================*/
	worker = new Worker('js/worker-pt.js');

	//communication to Worker
	worker.addEventListener('message', function(e) {
		switch (e.data) {
			case 'start':
				objCombProc.workerProc();
				break;
			case 'stop':
				//console.log('worker stop');
				objCombProc.resetAllAmDatIdx();
				break;
		};
	}, false);

	/*============================================================================
	Shortcut key
	============================================================================*/
	document.onkeydown = function(e){
		// console.log(e.keyCode);
		switch(e.keyCode){
			case 32: //space bar
				var ae = document.activeElement;
				if(ae.localName === 'select') ae.blur();	//NG:Mac-Firefox, OK:Win-Firefox, Chrome Mac-Safari, Chrome
				e.preventDefault();
				objCombProc.startAndStopSoundsFromDoc();
				break;
			case 49: //key '1'
			case 50: //key '2'
			case 51: //key '3'
				e.preventDefault();
				objCombProc.chgDisplayFromDoc(e.keyCode);
				break;
			case 72: //key 'h'
				if(e.metaKey || e.ctrlKey) return;	//skip for meta or ctrl + h
				e.preventDefault();
				objCombProc.chgReturnModeFromDoc();
				break;
			case 78: //key 'n'
				if(e.metaKey || e.ctrlKey) return;	//skip for meta or ctrl + n
				e.preventDefault();
				objNavi.chgNaviModeFromDoc();
				break;
			case 82: //key 'r'
				if(e.metaKey || e.ctrlKey) return;	//skip for meta or ctrl + r
				e.preventDefault();
				objCombProc.chgModeRepeatPlayFromDoc();
				break;
			case 83: //key 's' 
				e.preventDefault();
				objCombProc.moveStartPosFromDoc();
				break;
		}
	};

	/*============================================================================
	load audio file
	============================================================================*/
	// for(var i=0, len=numSongFiles; i<len; i++){
	//  	loadBuffer(dir+sounds[i].name+ext, i);
	// };


	document.addEventListener('touchstart', initAudioContext);
	function initAudioContext(){
  	document.removeEventListener('touchstart', initAudioContext);
  	// wake up AudioContext
  	const emptySource = context.createBufferSource();
  	emptySource.start();
  	emptySource.stop();

	for(var i=0, len=numSongFiles; i<len; i++){
	 	loadBuffer(dir+sounds[i].name+ext, i);
	};

}




	const eventName = typeof document.ontouchend !== 'undefined' ? 'touchend' : 'mouseup';
	document.addEventListener(eventName, initAudioContext);
	function initAudioContext(){
  		document.removeEventListener(eventName, initAudioContext);
	for(var i=0, len=numSongFiles; i<len; i++){
	 	loadBuffer(dir+sounds[i].name+ext, i);
	};


		  // wake up AudioContext
  		context.resume();
	}
}
