//Web Audio API
var playedTime = 0;
var startTime = 0;
var offsetTime = 0;
var songLength = null;
var enum_states = {					//current state
	loading: 0,								//loading audio files
	play: 1,									//play sound
	stop: 2,									//stop playback
	chgPlayPos: 3							//restart at clicked progress bar while playing sound
};
var state = enum_states.loading;

//for Worker
var worker = null;

//Web Audioをクロスブラウザ対応:Ssafariはwebkit系ブラウザ
var eqTypes = ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'];
function getEqTypeIdx(strType){
	switch (strType) {
		case 'lowpass': 	return 0;
		case 'highpass': 	return 1;
		case 'bandpass':	return 2;
		case 'lowshelf':	return 3;
		case 'highshelf': return 4;
		case 'peaking':		return 5;
		case 'notch': 		return 6;
		case 'allpass':
		default:					return 7;	//allpass and none
	}
};
//window.AudioContext = window.AudioContext || window.webkitAudioContext;
var AudioContext  = window.AudioContext || window.webkitAudioContext;
var context = new AudioContext();
context.resume();

/*==========================================================================
Get Audio Buffer by XHR 
==========================================================================*/
var loadBuffer = function(url, index) {
	var request = new XMLHttpRequest();
	request.open("GET", url, true);
	request.responseType = "arraybuffer";

	request.onload = function() {
		context.decodeAudioData(request.response,
			function(buffer) {
				if (!buffer) {
					console.log('error decoding file data: ' + url);
					return;
				};
				objCombProc.setAudioBufferFromXHRtoTrack(index, buffer);
				//console.log(index);
				if(songLength == null){
					songLength = buffer.duration;
				}
			},
			function(error) {
				console.error('decodeAudioData error', error);
			}
		);
	}

	request.onerror = function() {
		console.log('BufferLoader: XHR error');
	}

	request.send();
};



/*******************************************************************************
Sounds: Part and Master Ch
*******************************************************************************/
var sounds = null;
function Sound(){
	var	name = null;							//audio file name
	var part = null;							//intro, A, B, C, ending
	var audioBuffer = null;				//audio data via XHR
	var bufSrcNode = null;
	var startTime = null;
	var duration = null;					//audio duration
	var wavData = null;						//float data for drawing

	//filter and Analyser Node
	var gainNodeEqSwOn;						//4 band EQ eanble as SW
	var gainNodeEqSwOff;					//4 band EQ disenable(bypass) as SW
	var biquadFilterNodes;				//4 band EQ
	var gainNodesFilterSW;				//each EQ through SW related Bypass SW
	var gainNodesBypassSW;				//each EQ bypass SW related through SW
	var eqStates;									//array ofeach filter's on/off
	var analyserNode;							//Analyser for spectrum
	var isEQ											//true: enable 4 band EQ

	//compressor node
	var dynCompNode;							//Dynamic Compressor Node
	var gainNodeCompSwOn;					//Compressor eanble as SW
	var gainNodeCompSwOff;				//Compressor disenable(bypass) as SW
	var isComp										//true: enable comp

	var gainNodeInput;
	var gainNodeOutput;

	var pannerNode;								//Panner node
	var bufPanVal = null;					//buf Pan Value(-1.57(L) to 1.57(R) )
	var stPannerNode = null;			//Panner node
	var gainNode = null;					//Gain node
	var bufGain = null;						//init value is '1.0'.
	var chMode = null;						//init state is 'norm'.
	var chModeAm = null;					//init state is 'nouseAm'.
	var isPlayAudio;							//true: play, false:stop

	var isChMute = false;					//true: mute
	var isSolo = false;						//true: solo
	var isAutomationRec = false;
	var isAutomationPlay = false;
};
Sound.prototype.chStates = {
	norm: 'norm',				//no-mute and no-solo
	mute: 'mute',				//mute
	solo: 'solo',				//solo
	noUseAm: 'noUseAm',	//no-use Automation
	playAm: 'playAm',		//play Automation
	recAm:	'recAm',		//rec Automation
};
Sound.prototype.masterInputNode = {
	tgt: null,	//Master ch input gain node to connect each part Ch output
};
/*==============================================================================
init
==============================================================================*/
Sound.prototype.init = function(audioName, startTime){
	var self = this;
	self.name = audioName;
	if(audioName === 'OUTPUT'){
		self.part = audioName;
	}else{
		var arrayPartFileName = audioName.split("_");
		self.part = arrayPartFileName[0];
		self.startTime = startTime;
	}
	self.duration = null;


	/*------------------------------------------------------------------------
	Web Audio API node creation and connect each node 
	------------------------------------------------------------------------*/
	self.bufGain = 1.0;
	self.chMode = self.chStates.norm;
	self.chModeAm = self.chStates.noUseAm;
	self.isPlayAudio = false;
	self.isChMute = false;
	self.isSolo = false;
	self.isAutomationRec = false;

	//Filter
	self.isEQ = false;
	self.gainNodeEqSwOn = context.createGain();		//4 band EQ SW ON
	self.gainNodeEqSwOff = context.createGain();	//4 band EQ SW ON
	self.gainNodeEqSwOn.gain.value = 0
	self.gainNodeEqSwOff.gain.value = 1
	self.biquadFilterNodes = new Array(4);				//4 band EQ
	self.gainNodesFilterSW = new Array(4);				//each EQ through SW related Bypass SW
	self.gainNodesBypassSW = new Array(4);				//each EQ bypass SW related through SW
	self.eqStates = [false, false, false, false];
	var bufEqFreqs = [50, 200, 1000, 5000];

	for(var i=0, len=self.biquadFilterNodes.length; i<len; i++){
		self.gainNodesFilterSW[i] = context.createGain();
		self.gainNodesFilterSW[i].gain.value = 0;
		self.gainNodesBypassSW[i] = context.createGain();
		self.biquadFilterNodes[i] = context.createBiquadFilter();
		self.biquadFilterNodes[i].frequency.value = bufEqFreqs[i];
		self.biquadFilterNodes[i].Q.value = 0.1;
		self.biquadFilterNodes[i].gain.value = 0;
		if(i === 0)          self.biquadFilterNodes[i].type = (typeof self.biquadFilterNodes[i].type === 'string') ? 'lowshelf' : 3;  //3 is lowshelf(old format)
		else if(i === len-1) self.biquadFilterNodes[i].type = (typeof self.biquadFilterNodes[i].type === 'string') ? 'highshelf' : 4; //4 is highshelf(old format)
		else                 self.biquadFilterNodes[i].type = (typeof self.biquadFilterNodes[i].type === 'string') ? 'peaking' : 5;   //5 is peaking(old format)
	}
	//console.log(self.biquadFilterNodes);

	//Analyzer(FFT) for Filter
	self.analyserNode = context.createAnalyser();
	self.analyserNode.smoothingTimeConstant = 0.6;
	self.analyserNode.fftSize = 2048;
	self.analyserNode.minDecibels = -140;	//A graph is shown in all frequency range in the case of default -100dB.

	//Compressor
	self.isComp = false;
	self.dynCompNode = context.createDynamicsCompressor();
	self.dynCompNode.threshold.value = 0;
	self.dynCompNode.knee.value = 0;
	self.dynCompNode.ratio.value = 1;
	self.dynCompNode.attack.value = 0;
	self.dynCompNode.release.value = 0.25;
	self.gainNodeCompSwOn = context.createGain();
	self.gainNodeCompSwOn.gain.value = 0;
	self.gainNodeCompSwOff = context.createGain();
	self.gainNodeCompSwOff.gain.value = 1;

	//Pan
	self.pannerNode = context.createPanner();
	self.pannerNode.setPosition(0,0,1);		//position: center
	self.bufPanVal = 0;										//pan value 0: center
	self.pannerNode.pannningModel = (typeof self.pannerNode.pannningModel === 'string') ? 'eqaulpower' : 0;	//0 is equalpower
	//self.stPannerNode = context.createStereoPanner();

	//gain
	self.gainNodeInput = context.createGain();
	self.gainNodeOutput = context.createGain();

	/* connection each node ----------------------------------------------------*/
	//4 filters connection to gainNode as SW on / off 
	// self.gainNodeInput.connect(self.gainNodesFilterSW[0]);
	// self.gainNodeInput.connect(self.gainNodesBypassSW[0]);
	self.gainNodeInput.connect(self.gainNodeEqSwOn);
	self.gainNodeInput.connect(self.gainNodeEqSwOff);
	self.gainNodeEqSwOn.connect(self.gainNodesFilterSW[0]);
	self.gainNodeEqSwOn.connect(self.gainNodesBypassSW[0]);
	self.gainNodeEqSwOff.connect(self.gainNodeCompSwOn);
	self.gainNodeEqSwOff.connect(self.gainNodeCompSwOff);

	self.gainNodesFilterSW[0].connect(self.biquadFilterNodes[0]);
	for(var i=0; i<3; i++){
		self.biquadFilterNodes[i].connect(self.gainNodesFilterSW[i+1]);
		self.biquadFilterNodes[i].connect(self.gainNodesBypassSW[i+1]);
		self.gainNodesBypassSW[i].connect(self.gainNodesFilterSW[i+1]);
		self.gainNodesBypassSW[i].connect(self.gainNodesBypassSW[i+1]);
		self.gainNodesFilterSW[i+1].connect(self.biquadFilterNodes[i+1]); //connect from SW to filter
	}
	//Filter to Analyzer
	self.biquadFilterNodes[3].connect(self.analyserNode);
	self.gainNodesBypassSW[3].connect(self.analyserNode);

	//Filter to Comp
	self.biquadFilterNodes[3].connect(self.gainNodeCompSwOn);
	self.biquadFilterNodes[3].connect(self.gainNodeCompSwOff);
	self.gainNodesBypassSW[3].connect(self.gainNodeCompSwOn);
	self.gainNodesBypassSW[3].connect(self.gainNodeCompSwOff);
	self.gainNodeCompSwOn.connect(self.dynCompNode);
	
	//Comp to Pan
	self.dynCompNode.connect(self.pannerNode);
	self.gainNodeCompSwOff.connect(self.pannerNode);

	self.pannerNode.connect(self.gainNodeOutput);
	//self.gainNodeOutput.connect(context.destination);
};
/*==============================================================================
Set output destination each Ch.
==============================================================================*/
Sound.prototype.outputDestination = function(outputDest){
		this.gainNodeOutput.connect(outputDest);
};
/*==============================================================================
Stop Sounds
==============================================================================*/
Sound.prototype.stop = function(){
	if(this.isPlayAudio) this.bufSrcNode.stop();
};
/*==============================================================================
Play Sound
==============================================================================*/
Sound.prototype.play = function(){
	var self = this;	//for access array Sounds's property isPlayAudio in the function 'onended'
	self.bufSrcNode = context.createBufferSource();
	self.bufSrcNode.buffer = this.audioBuffer;			//set audiobuffer
	self.bufSrcNode.connect(self.gainNodeInput);		//audiobuffer to ch panning
	if(self.startTime >= offsetTime){
		//self.startTime - offsetTime >= 0
		self.bufSrcNode.start(startTime + self.startTime  - offsetTime, 0);	//2nd argument is offset play time
	}else{
		//self.startTime - offsetTime < 0 === offsetTime > self.startTime
		var del = offsetTime - self.startTime;
		if(del < self.duration){
			self.bufSrcNode.start(startTime, del);			//2nd argument is offset play time
		}else{
			self.isPlayAudio = false;										//each audio stop
			return;
		}
	}
	self.isPlayAudio = true;												//each audio playing

	self.bufSrcNode.onended = function(event){			//Event for stop or ended playback
		//worker.postMessage('stop');									//stop an interval Worker process

		self.isPlayAudio = false;											//each audio stop
		if(objCombProc.isStoppedAllSounds()){					//check All audio stop
			switch (state) {
				case enum_states.play:										//state: play
					//no proc
					break;
				case enum_states.stop:										//state: stop
					//no proc
					break;
				case enum_states.chgPlayPos:							//state: restart
					objCombProc.playAudio();								//playback
					break;
			}
		}
	}
};

/*******************************************************************************
 Filter and Analyser Node 
*******************************************************************************/
/*==============================================================================
 Get Analyser Node
==============================================================================*/
Sound.prototype.getAnalyserNode = function(){
	return this.analyserNode;
};
/*==============================================================================
 Get A filter type
==============================================================================*/
Sound.prototype.getFilterTypeIdx = function(filterNo){
	var aFilterParam = this.getFilterParam(filterNo)
	return aFilterParam.type;
};
/*==============================================================================
Get A filter paramater
==============================================================================*/
Sound.prototype.getFilterParam = function(filterNo){
	var self = this;
		return {
			state: self.eqStates[filterNo],
			type: (typeof self.biquadFilterNodes[filterNo].type === 'string') ? getEqTypeIdx(self.biquadFilterNodes[filterNo].type) : self.biquadFilterNodes[filterNo].type,
			freq: self.biquadFilterNodes[filterNo].frequency.value,
			q: self.biquadFilterNodes[filterNo].Q.value,
			gain: self.biquadFilterNodes[filterNo].gain.value,
		}
};
/*==============================================================================
Get EQ paramater - AnalyserNode, EQ on/off state, All Filters paramater
==============================================================================*/
Sound.prototype.getEqParam = function(){
	var len = this.eqStates.length;
	var allFilterParams = new Array(len);
	for(var i=0; i<len; i++){
		allFilterParams[i] = this.getFilterParam(i);
	}
	return {
		analyserNode:    this.analyserNode,
		isEQ:            this.isEQ,
		allFilterParams: allFilterParams,
	}
};
/*==============================================================================
Switch EQ ON / OFF
==============================================================================*/
Sound.prototype.switchEQ = function(asgnEqSW){
	//assigened EQ SW
	if(asgnEqSW === true)       this.isEQ = false;	//turn ON  under proc
	else if(asgnEqSW === false) this.isEQ = true;		//turn OFF under proc

	if(this.isEQ){
		this.gainNodeEqSwOn.gain.value = 0;		//EQ OFF
		this.gainNodeEqSwOff.gain.value = 1;	//FX Bypass ON
		this.isEQ = false;
	}else{																			//Bypass compressor
		this.gainNodeEqSwOn.gain.value = 1;		//EQ ON
		this.gainNodeEqSwOff.gain.value = 0;	//FX BYypass OFF
		this.isEQ = true;
	}
	return this.isEQ;
}
/*==============================================================================
Switch a Filter ON / OFF
==============================================================================*/
Sound.prototype.switchFilter = function(filterNo, asgnFiltSW){
	//assigned Filter SW
	if(asgnFiltSW === true)       this.eqStates[filterNo] = false;	//turn ON  under proc
	else if(asgnFiltSW === false) this.eqStates[filterNo] = true;		//turn OFF under proc

	var self = this;
	if(self.eqStates[filterNo]){														//filter SW ON -> OFF
		self.gainNodesFilterSW[filterNo].gain.value = 0;			//Filter OFF
		self.gainNodesBypassSW[filterNo].gain.value = 1;			//Bypass ON

		self.eqStates[filterNo] = false;											//state chagne
		//console.log('Filter No.' + filterNo + ' swicthed OFF @ Sound()');
		return null;
	}else{																									//filter SW OFF -> ON
		self.gainNodesFilterSW[filterNo].gain.value = 1;			//Filter OFF
		self.gainNodesBypassSW[filterNo].gain.value = 0;			//Bypass ON
		self.eqStates[filterNo] = true;												//state change
		//console.log('Filter No.' + filterNo + ' swicthed ON @ Sounds()');
		return this.getFilterParam(filterNo);									//assigend filter paramater
	}
};
/*==============================================================================
Change Filter Type
==============================================================================*/
Sound.prototype.chgFilterType = function(filterNo, idxType){
	var self = this;
	//old eq node was cahnged type by number, new eq node is using string.
	self.biquadFilterNodes[filterNo].type = (typeof self.biquadFilterNodes[filterNo].type === 'string') ? eqTypes[idxType] : idxType;
	//console.log('Filter No.' + filterNo + ' changed frequency Type:' + eqTypes[idxType] + ' @ Sounds()');
};
/*==============================================================================
Change Filter Frequency
==============================================================================*/
Sound.prototype.chgFilterFreq = function(filterNo, freq){
	var self = this;
	self.biquadFilterNodes[filterNo].frequency.value = freq;
	//console.log('Filter No.' + filterNo + ' changed frequency:' + freq + ' @ Sounds()');
};
/*==============================================================================
Change Filter Q
==============================================================================*/
Sound.prototype.chgFilterQ = function(filterNo, q){
	var self = this;
	//console.log(q);
	self.biquadFilterNodes[filterNo].Q.value = q;
	//console.log('Filter No.' + filterNo + ' changed Q:' + q + ' @ Sounds()');
};
/*==============================================================================
Change Filter Gain
==============================================================================*/
Sound.prototype.chgFilterGain = function(filterNo, gain){
	var self = this;
	self.biquadFilterNodes[filterNo].gain.value = gain;
	//console.log('Filter No.' + filterNo + ' changed gain:' + gain + ' @ Sounds()');
};


/*******************************************************************************
Compressor Node 
*******************************************************************************/
/*==============================================================================
Get Comp All Parameters
==============================================================================*/
Sound.prototype.getCompAllParams = function(){
	return {
		sw:          this.isComp,
		threshold:   this.dynCompNode.threshold.value,
		knee:        this.dynCompNode.knee.value,
		ratio:       this.dynCompNode.ratio.value,
		reduction:   this.dynCompNode.reduction,		//reduction is 'readonly'.
		attack:      this.dynCompNode.attack.value,
		release:     this.dynCompNode.release.value,
		dynCompNode: this.dynCompNode,							//for Reduction(Read Only Usage!) 
	};
}

/*==============================================================================
Switch a Compressor ON / OFF
==============================================================================*/
Sound.prototype.switchComp = function(asgnCompSW){
	if(asgnCompSW === true) this.isComp = false;			//turn on under proc
	else if(asgnCompSW === false) this.isComp = true;	//turn off under proc

	if(this.isComp){
		this.gainNodeCompSwOn.gain.value = 0;		//Comp OFF
		this.gainNodeCompSwOff.gain.value = 1;	//FX Bypass ON
		this.isComp = false;
	}else{																			//Bypass compressor
		this.gainNodeCompSwOn.gain.value = 1;		//Comp ON
		this.gainNodeCompSwOff.gain.value = 0;	//FX Bypass OFF
		this.isComp = true;
	}
	return this.isComp;
};
/*==============================================================================
Set threshold value
==============================================================================*/
Sound.prototype.setThreshold = function(threshold){
	this.dynCompNode.threshold.value = threshold;
};
/*==============================================================================
Set knee value
==============================================================================*/
Sound.prototype.setKnee = function(knee){
	this.dynCompNode.knee.value = knee;
};
/*==============================================================================
Set Ratio value
==============================================================================*/
Sound.prototype.setRatio = function(ratio){
	this.dynCompNode.ratio.value = ratio;
};
/*==============================================================================
Set Attack value
==============================================================================*/
Sound.prototype.setAttack = function(attack){
	this.dynCompNode.attack.value = attack;
};
/*==============================================================================
Set Release value
==============================================================================*/
Sound.prototype.setRelease = function(release){
	this.dynCompNode.release.value = release;
};


/*******************************************************************************
Pannning Node
*******************************************************************************/
/*==============================================================================
Set Panning Value
==============================================================================*/
Sound.prototype.setPanVal = function(pan){
	this.bufPanVal = pan;
	this.pannerNode.setPosition(Math.sin(pan), 0, -Math.cos(pan));
};


/*******************************************************************************
gain Node
*******************************************************************************/
/*==============================================================================
Set Gain Value
==============================================================================*/
Sound.prototype.setGainVal = function(gain){
		this.gainNodeOutput.gain.value  = gain;
};

/*==============================================================================
Change gainNode value as SW 
==============================================================================*/
Sound.prototype.turnOnOffNodeGain = function(isOn){
	var self = this;
	if(isOn){
		this.gainNodeInput.gain.value = 1;
	}else{
		this.gainNodeInput.gain.value = 0;
	}
};

/*==============================================================================
Change ch Mode to Norm 	
==============================================================================*/
Sound.prototype.switchNorm = function(){
	this.chMode = this.chStates.norm;
};

/*==============================================================================
Change ch Mode to Mute
==============================================================================*/
Sound.prototype.switchMute = function(){
	this.chMode = this.chStates.mute;
};

/*==============================================================================
Change ch Mode to Solo
==============================================================================*/
Sound.prototype.switchSolo = function(){
	this.chMode = this.chStates.solo;
};

/*==============================================================================
Get current Ch. mode
==============================================================================*/
Sound.prototype.getChMode = function(){
	return this.chMode;
};

/*==============================================================================
Get current Ch. pan, gain, Ch mode
==============================================================================*/
Sound.prototype.getPanGainChMode = function(){
	return {
		pan: this.bufPanVal,
		gain: this.gainNodeOutput.gain.value,
		chMode:this.chMode,
	};
};



/*******************************************************************************
Transpose
*******************************************************************************/
var objTranspose = {
	prjMaxTime: 180,	//project maximum time for playedTime, repeat

	/* Played time -------------------------------------------------------------*/
	cvsPlayMrk:null,
	spnMin:    null,
	spnSec:    null,
	spnMsec:   null,
	cvsMin:    null,
	cvsSec:    null,
	cvsMsec:   null,

	/* Playback ----------------------------------------------------------------*/
	cvsPbZero:   null,
	cvsPbPlay:   null,
	cvsPbStop:   null,
	cvsPbReturn: null,
	cvsPbRepeat: null,

	/* Repeat Time -------------------------------------------------------------*/
	//Repeat Start Time
	cvsRptStartMark: null,
	spnRptStartMin: null,
	spnRptStartSec: null,
	spnRptStartMsec: null,
	cvsRptStartMin: null,
	cvsRptStartSec: null,
	cvsRptStartMsec: null,

	//Repeat End Time
	cvsRptEndMark: null,
	spnRptEndMin: null,
	spnRptEndSec: null,
	spnRptEndMsec: null,
	cvsRptEndMin: null,
	cvsRptEndSec: null,
	cvsRptEndMsec: null,

	/* Played Time and Repeat Start/End Time Drag and Drop Event ---------------*/
	enum_timeKind: {
		pt: 'playedTime',
		rst: 'repeatStartTime',
		ret: 'repeatEndTime',
	},
	strStartTopPT:  '5px',	//each start Top position of span played time params. see CSS definition
	strStartTopRST: '5px',
	strStartTopRET: '5px',
	bufSpnVal: null,
	bufDndVal: null,
	dndEvts: [],
	colorFocusOn:  'azure',
	colorFocusOff: 'white',

	/* Play Button -------------------------------------------------------------*/
	playOnColor: 'LightGreen',
	playOffColor: 'white',

	/* Return button -----------------------------------------------------------*/
	returnOnColor: 'orange',
	returnOffColor: 'white',

	/* Repeat button -----------------------------------------------------------*/
	repeatOnColor: '#FF90FF',	//based on lavender
	repeatOffColor: 'white',

	/* Display Mode ------------------------------------------------------------*/
	e_btnTrDispMode:   null,
	e_btnMidxDispMode: null,
	e_btnFxDispMode:   null,

	/* Navigation --------------------------------------------------------------*/
	navType: null,	//navigation type


	/*============================================================================
	init
	============================================================================*/
	init: function(){
		this.prjMaxTime = objCombProc.getPrjMaxTime();	//project maximum time
		this.navType = objNavi.getNavType();						//navigation type

		/* Played Time -----------------------------------------------------------*/
		this.initPlayedTime();

		/* Repeat Time -----------------------------------------------------------*/
		this.initRepeat();

		/* PlayBack Canvases -----------------------------------------------------*/
		this.initPlayBack();

		/* Direct Repeat Button --------------------------------------------------*/
		this.initDirRptBtn();

		/* init Display Mode -----------------------------------------------------*/
		this.initDispMode();
	}, //EOF init


	/*****************************************************************************
	Played Time
	*****************************************************************************/
	initPlayedTime: function(){
		this.cvsPlayMrk = document.getElementById('cvsPlayMrk');

		/* Navigation ------------------------------------------------------------*/
		this.navPlayMrk();

		/* Drar Play Mark --------------------------------------------------------*/
		this.drawPlayMrk();

		/* set each elements -----------------------------------------------------*/
		this.spnMin = document.getElementById('spnMin');
		this.spnSec = document.getElementById('spnSec');
		this.spnMsec = document.getElementById('spnMsec');
		this.cvsMin = document.getElementById('cvsMin');
		this.cvsSec = document.getElementById('cvsSec');
		this.cvsMsec = document.getElementById('cvsMsec');

		/* Regist drag and drop event for min, sec, msec -------------------------*/
		this.makeTimeEvt(this.cvsMin,  this.spnMin,  this.enum_timeKind.pt, 'min',  this.strStartTopPT);
		this.makeTimeEvt(this.cvsSec,  this.spnSec,  this.enum_timeKind.pt, 'sec',  this.strStartTopPT);
		this.makeTimeEvt(this.cvsMsec, this.spnMsec, this.enum_timeKind.pt, 'msec', this.strStartTopPT);

		/* Set Played Time -------------------------------------------------------*/
		this.setPlayedTime(objCombProc.getPlayTime());
	},
	/*============================================================================
	Navigation
	============================================================================*/
	navPlayMrk: function(){
		var self = this;
		this.cvsPlayMrk.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpPlayMrk, e.clientX, e.clientY);
		};
		this.cvsPlayMrk.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};
	},
	/*============================================================================
	Draw Play Mark
	============================================================================*/
	drawPlayMrk: function(){
		var cvs = this.cvsPlayMrk
		cvsCtx = cvs.getContext('2d');

		cvsCtx.clearRect(0, 0, cvs.width, cvs.height);
		cvsCtx.fillStyle = 'whitesmoke';
		cvsCtx.beginPath();
		cvsCtx.moveTo(0, 0);
		cvsCtx.lineTo(cvs.width, cvs.height/2);
		cvsCtx.lineTo(0, cvs.height);
		cvsCtx.closePath();
		cvsCtx.fill();
	},
	/*=============================================================================
	Set Played Time
	============================================================================*/
	setPlayedTime: function(valTime){
		var strTime = this.getStrMinSecMsec(valTime);
		this.spnMin.innerHTML = strTime.min;
		this.spnSec.innerHTML = strTime.sec;
		this.spnMsec.innerHTML = strTime.msec;
	},



	/*****************************************************************************
	Repeat Start and End Time Counter
	*****************************************************************************/
	initRepeat: function(){
		/* Repeat Start ----------------------------------------------------------*/
		this.spnRptStartMin = document.getElementById('spnRptStartMin');
		this.spnRptStartSec = document.getElementById('spnRptStartSec');
		this.spnRptStartMsec = document.getElementById('spnRptStartMsec');
		this.cvsRptStartMin = document.getElementById('cvsRptStartMin'),
		this.cvsRptStartSec = document.getElementById('cvsRptStartSec'),
		this.cvsRptStartMsec = document.getElementById('cvsRptStartMsec'),

		/* Regist drag and drop event: Repeat Start Time -------------------------*/
		this.makeTimeEvt(this.cvsRptStartMin,  this.spnRptStartMin,  this.enum_timeKind.rst, 'min',  this.strStartTopRST);
		this.makeTimeEvt(this.cvsRptStartSec,  this.spnRptStartSec,  this.enum_timeKind.rst, 'sec',  this.strStartTopRST);
		this.makeTimeEvt(this.cvsRptStartMsec, this.spnRptStartMsec, this.enum_timeKind.rst, 'msec', this.strStartTopRST);

		/* Repeat End ------------------------------------------------------------*/
		this.spnRptEndMin = document.getElementById('spnRptEndMin');
		this.spnRptEndSec = document.getElementById('spnRptEndSec');
		this.spnRptEndMsec = document.getElementById('spnRptEndMsec');
		this.cvsRptEndMin = document.getElementById('cvsRptEndMin'),
		this.cvsRptEndSec = document.getElementById('cvsRptEndSec'),
		this.cvsRptEndMsec = document.getElementById('cvsRptEndMsec'),

		/* Regist drag and drop event: Repeat Start Time -------------------------*/
		this.makeTimeEvt(this.cvsRptEndMin,  this.spnRptEndMin,  this.enum_timeKind.ret, 'min',  this.strStartTopRET);
		this.makeTimeEvt(this.cvsRptEndSec,  this.spnRptEndSec,  this.enum_timeKind.ret, 'sec',  this.strStartTopRET);
		this.makeTimeEvt(this.cvsRptEndMsec, this.spnRptEndMsec, this.enum_timeKind.ret, 'msec', this.strStartTopRET);

		/* Draw Repeat Start & End Mark ------------------------------------------*/
		this.cvsRptStartMark = document.getElementById('cvsRptStartMark'),
		this.cvsRptEndMark = document.getElementById('cvsRptEndMark'),
		this.drawRepeatMark();

		/* Navigation ------------------------------------------------------------*/
		this.navRptStartEndTimd();

		/* Set Repeat Start and End Time -----------------------------------------*/
		var initRepeatTimes = objCombProc.getRepeatStartEndTime();
		this.setRepeatStartTime(initRepeatTimes.repeatStartTime);
		this.setRepeatEndTime(initRepeatTimes.repeatEndTime);
	},
	/*============================================================================
	Set Repeat Start Time
	============================================================================*/
	setRepeatStartTime: function(repeatStartTime){
		var strTime = this.getStrMinSecMsec(repeatStartTime);
		this.spnRptStartMin.innerHTML = strTime.min;
		this.spnRptStartSec.innerHTML = strTime.sec;
		this.spnRptStartMsec.innerHTML = strTime.msec;
	},
	/*============================================================================
	Set Repeat End Time
	============================================================================*/
	setRepeatEndTime: function(repeatEndTime){
		var strTime = this.getStrMinSecMsec(repeatEndTime);
		this.spnRptEndMin.innerHTML = strTime.min;
		this.spnRptEndSec.innerHTML = strTime.sec;
		this.spnRptEndMsec.innerHTML = strTime.msec;
	},

	/*****************************************************************************
	Common proc of time  
	*****************************************************************************/
	/*============================================================================
	Make Drag and Drop Event for min, sec, msec
	============================================================================*/
	makeTimeEvt: function(cvs, spn, timeKind, timeType, strStartTop){
		var self = this;
		//EVENT:mouse over / out
		cvs.onmouseover = function(e){
			if(self.bufSpnVal === null){
				spn.style.backgroundColor = self.colorFocusOn;
				if(isNavi) objNavi.dispMsg(self.navType.tpTime, e.clientX, e.clientY); //Navigation
			}
		};
		cvs.onmouseout = function(){
			spn.style.backgroundColor = self.colorFocusOff;
			if(isNavi) objNavi.hideMsg();						//Navigation
		};

		//time value control with jQuery plug-in 'Draggabliiy'
		var dndEvt = new Draggabilly(cvs, {axis:'y'});	//moving direction: vertical
		//EVENT:<canvas> mouse click -----------------------------------------------
		dndEvt.on('pointerDown', function(){
			self.bufDndVal = null;
			self.bufSpnVal = self.getTimeFromSpan(timeKind);
			self.funcPointerDown(timeKind);
		});
		//EVENT:<canvas> draggin ---------------------------------------------------
		dndEvt.on('dragMove', function(event, pointer, moveVector){
			spn.style.backgroundColor = self.colorFocusOn;
			//Change time in drag & drop
			var timeVal = self.chgTimeInDnD(timeType, self.bufSpnVal, -moveVector.y);
			//Check same value or not
			if(self.bufDndVal === timeVal) return;
			else self.bufDndVal = timeVal;
			//Set time to span
			self.setTimeToSpnInDnD(timeKind, timeVal);
			//Send update sec time to other proc
			self.funcDragMove(timeKind);
		});
		//EVENT:<canvas> drag end --------------------------------------------------
		dndEvt.on('dragEnd', function(event){
			this.element.style.top = strStartTop;																	//Reset top position 
			self.bufSpnVal = null;
			self.bufDndVal = null;
			spn.style.backgroundColor = self.colorFocusOff;
			self.funcDragEnd(timeKind);
		}); 
		this.dndEvts.push(dndEvt);	//regist <canvas>'s drag and drag evbents.
	},
	/*----------------------------------------------------------------------------
	function in pointerDown
	----------------------------------------------------------------------------*/
	funcPointerDown(timeKind){
		if(timeKind === this.enum_timeKind.pt) objCombProc.startPtChgFromTranspose();
	},
	/*----------------------------------------------------------------------------
	Change Time in Drag and Drop
	----------------------------------------------------------------------------*/
	chgTimeInDnD(timeType, baseTime, delta){
		switch(timeType){
			case 'min':
				var val = baseTime + delta * 60;
				break;
			case 'sec':
				var val = baseTime + delta;
				break;
			case 'msec':
				 var val = baseTime + delta / 1000;
				break; 
		};
		//check max / min time
		if(val > this.prjMaxTime) val = this.prjMaxTime;
		else if(val < 0) val = 0;
		return val;
	},
	/*----------------------------------------------------------------------------
	Set Time to span in Drag and Drop
	----------------------------------------------------------------------------*/
	setTimeToSpnInDnD(timeKind, updateTime){
		switch(timeKind){
			case this.enum_timeKind.pt: //played time
				this.setPlayedTime(updateTime);
				break;
			case this.enum_timeKind.rst: //repeat start time
				this.setRepeatStartTime(updateTime);
				break;
			case this.enum_timeKind.ret: //repeat end time
				this.setRepeatEndTime(updateTime);
				break;
		};
	},
	/*----------------------------------------------------------------------------
	function in dragMove
	----------------------------------------------------------------------------*/
	funcDragMove(timeKind){
		var timeVal = this.getTimeFromSpan(timeKind);
		if(timeKind === this.enum_timeKind.pt)  objCombProc.chgingPtFromTranspose(timeVal);
		if(timeKind === this.enum_timeKind.rst) objCombProc.chgingRSTfromTranspose(timeVal);
		if(timeKind === this.enum_timeKind.ret) objCombProc.chgingRETfromTranspose(timeVal);
	},
	/*----------------------------------------------------------------------------
	function in dragEnd
	----------------------------------------------------------------------------*/
	funcDragEnd(timeKind){
		var timeVal = this.getTimeFromSpan(timeKind);
		if(timeKind === this.enum_timeKind.pt) objCombProc.endPtChgFromTranspose(timeVal);
	},
	/*----------------------------------------------------------------------------
	Get Time from Span
	----------------------------------------------------------------------------*/
	getTimeFromSpan: function(timeKind){
		switch(timeKind){
			case this.enum_timeKind.pt: //played time
				var min = parseInt(this.spnMin.innerHTML);
				var sec = parseInt(this.spnSec.innerHTML);
				var msec = parseInt(this.spnMsec.innerHTML);
				break;
			case this.enum_timeKind.rst: //repeat start time
				var min = parseInt(this.spnRptStartMin.innerHTML);
				var sec = parseInt(this.spnRptStartSec.innerHTML);
				var msec = parseInt(this.spnRptStartMsec.innerHTML);
				break;
			case this.enum_timeKind.ret: //repeat end time
				var min = parseInt(this.spnRptEndMin.innerHTML);
				var sec = parseInt(this.spnRptEndSec.innerHTML);
				var msec = parseInt(this.spnRptEndMsec.innerHTML);
				break;
		};
		return min * 60 + sec + msec / 1000;
	},
	/*============================================================================
	Get string min, sec, msec
	============================================================================*/
	getStrMinSecMsec(valTime){
		var min, sec, msec, undSec;
		min = String( Math.floor(valTime / 60) );				//min(String)
		undSec = valTime % 60;													//under sec(double) 
		sec = Math.floor(undSec);												//sec(double)
		msec = Math.ceil((undSec - sec) * 1000);				//msec(double)
		if(msec === 1000){	//measure for the calculation error of Math.ceil  
			msec = 0;
			sec = sec + 1;
		}
		if(min.length === 1) min = '0' + min;						//'0' -> '00'
		sec = String(sec);
		if(sec.length === 1) sec = '0' + sec;						//'0' -> '00'
		msec = String(msec);
		if(msec.length === 1) msec = '00' + msec;				//'0'  -> '000'
		else if(msec.length === 2) msec = '0' + msec;		//'00' -> '000'
		return {
			min: min,
			sec: sec,
			msec: msec,
		};
	},


	/*****************************************************************************
	Draw Repeat Start / End Mark
	*****************************************************************************/
	drawRepeatMark: function(){
		var cvs, cvsCtx;
		for(i=0; i<2; i++){
			if(i === 0) cvs = this.cvsRptStartMark;
			else cvs = this.cvsRptEndMark;
			cvsCtx = cvs.getContext('2d');
			cvsCtx.clearRect(0, 0, cvs.width, cvs.height);
			cvsCtx.fillStyle = 'whitesmoke';
			cvsCtx.beginPath();
			cvsCtx.moveTo(0, 0);
			cvsCtx.lineTo(cvs.width, 0);
			if(i === 0) cvsCtx.lineTo(0, cvs.height);
			else cvsCtx.lineTo(cvs.width, cvs.height);
			cvsCtx.closePath();
			cvsCtx.fill();
		}
	},

	/*============================================================================
	Navigation
	============================================================================*/
	navRptStartEndTimd: function(){
		var self = this;
		/* Repeat Start Time -----------------------------------------------------*/
		this.cvsRptStartMark.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpRptStartMrk, e.clientX, e.clientY);
		};
		this.cvsRptStartMark.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};

		/* Repeat End Time -------------------------------------------------------*/
		this.cvsRptEndMark.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpRptEndMrk, e.clientX, e.clientY);
		};
		this.cvsRptEndMark.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};
	},


	/*****************************************************************************
	PlayBack Buttons
	*****************************************************************************/
	initPlayBack: function(){
		/* init canvas of Playback:zero  -----------------------------------------*/
		this.initCvsPbZero();

		/* init canvas of Playback:play  -----------------------------------------*/
		this.initCvsPbPlay();

		/* init canvas of Playback:stop  -----------------------------------------*/
		this.initCvsPbStop();

		/* init canvas of Playback:return ----------------------------------------*/
		this.initCvsPbReturn();

		/* init canvas of Playback:repeat ----------------------------------------*/
		this.initCvsPbRepeat();
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	PlayBack:Zero sec
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	initCvsPbZero: function(){
		/* set element -----------------------------------------------------------*/
		this.cvsPbZero = document.getElementById('cvsPbZero');

		/* Draw Mark -------------------------------------------------------------*/
		var cvs = this.cvsPbZero;
		var cvsCtx = cvs.getContext('2d');
		cvsCtx.clearRect(0, 0, cvs.width, cvs.height);

		cvsCtx.fillStyle = 'black';
		//vertical line
		cvsCtx.beginPath();
		cvsCtx.moveTo(8, 4);
		cvsCtx.lineTo(8, 17);
		cvsCtx.stroke();
		//Triangle
		cvsCtx.beginPath();
		cvsCtx.moveTo(9, cvs.height/2);
		cvsCtx.lineTo(cvs.width-8, 4);
		cvsCtx.lineTo(cvs.width-8, 17);
		cvsCtx.closePath();
		cvsCtx.fill();

		/* Event -----------------------------------------------------------------*/
		var self = this;
		this.cvsPbZero.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpPT0, e.clientX, e.clientY);
		};

		this.cvsPbZero.onmouseout = function(e){
			if(isNavi) objNavi.hideMsg();
		};

		this.cvsPbZero.onclick = function(){
			objCombProc.moveStartPosFromTranspose();
			self.setPlayedTime(0);									//set Play 'TIME' on Transpose
		};
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	PlayBack:Play
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	initCvsPbPlay: function(){
		/* set element -----------------------------------------------------------*/
		this.cvsPbPlay = document.getElementById('cvsPbPlay');

		/* Draw Mark -------------------------------------------------------------*/
		var cvs = this.cvsPbPlay;
		var cvsCtx = cvs.getContext('2d');
		cvsCtx.clearRect(0, 0, cvs.width, cvs.height);

		cvsCtx.fillStyle = 'black';
		//Triangle
		cvsCtx.beginPath();
		cvsCtx.moveTo(9, 4);
		cvsCtx.lineTo(9, 17);
		cvsCtx.lineTo(cvs.width-8, cvs.height/2);
		cvsCtx.closePath();
		cvsCtx.fill();

		/* Event -----------------------------------------------------------------*/
		var self = this;
		this.cvsPbPlay.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpPlay, e.clientX, e.clientY);
		};

		this.cvsPbPlay.onmouseout = function(e){
			if(isNavi) objNavi.hideMsg();
		};

		this.cvsPbPlay.onclick = function(){
			var isPlaying = objCombProc.playOrderFromTranspose();
			self.setPlayCvsColor(isPlaying);
		};
	},
	/*============================================================================
	Set Play canvas backgroundColor
	============================================================================*/
	setPlayCvsColor: function(isPlaying){
		if(isPlaying) this.cvsPbPlay.style.backgroundColor = this.playOnColor;
		else          this.cvsPbPlay.style.backgroundColor = this.playOffColor;
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	PlayBack:Stop
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	initCvsPbStop: function(){
		/* set element -----------------------------------------------------------*/
		this.cvsPbStop = document.getElementById('cvsPbStop');

		/* Draw Mark -------------------------------------------------------------*/
		var cvs = this.cvsPbStop;
		var cvsCtx = cvs.getContext('2d');
		cvsCtx.clearRect(0, 0, cvs.width, cvs.height);

		cvsCtx.fillStyle = 'black';
		//Rectangle
		cvsCtx.fillRect(8, 5, cvs.width-16, cvs.height-9);

		/* Event -----------------------------------------------------------------*/
		var self = this;
		this.cvsPbStop.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpStop, e.clientX, e.clientY);
		};

		this.cvsPbStop.onmouseout = function(e){
			if(isNavi) objNavi.hideMsg();
		};

		this.cvsPbStop.onclick = function(){
			objCombProc.stopOrderFromTranspose();
			self.cvsPbPlay.style.backgroundColor = self.playOffColor;
		};
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Playback:Return
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	initCvsPbReturn: function(){
		/* set element -----------------------------------------------------------*/
		this.cvsPbReturn = document.getElementById('cvsPbReturn');

		/* Draw Mark -------------------------------------------------------------*/
		var cvs = this.cvsPbReturn;
		var cvsCtx = cvs.getContext('2d');
		cvsCtx.clearRect(0, 0, cvs.width, cvs.height);

		cvsCtx.fillStyle = 'black';
		//Triangle - Play Mark
		cvsCtx.beginPath();
		cvsCtx.moveTo(3, 2);
		cvsCtx.lineTo(3, 8);
		cvsCtx.lineTo(8, 5);
		cvsCtx.closePath();
		cvsCtx.fill();
		//Rectangle - Stop Mark
		cvsCtx.fillRect(cvs.width-7.5, 2.5, 5, 5);
		//vertical left line
		cvsCtx.beginPath();
		// cvsCtx.moveTo(5, 3);
		cvsCtx.moveTo(5, 9);
		cvsCtx.lineTo(5, cvs.height-3);
		cvsCtx.stroke();
		//vertical right line
		cvsCtx.beginPath();
		// cvsCtx.moveTo(cvs.width-5, 3);
		cvsCtx.moveTo(cvs.width-5, 9);
		cvsCtx.lineTo(cvs.width-5, cvs.height-3);
		cvsCtx.stroke();
		//horizontal line
		cvsCtx.beginPath();
		// cvsCtx.moveTo(8, cvs.height-8);
		// cvsCtx.lineTo(cvs.width-8, cvs.height-8);
		cvsCtx.moveTo(8, cvs.height-7);
		cvsCtx.lineTo(cvs.width-8, cvs.height-7);
		cvsCtx.stroke();
		//Triangle
		cvsCtx.beginPath();
		// cvsCtx.moveTo(8, cvs.height-8);
		// cvsCtx.lineTo(12, cvs.height-12);
		// cvsCtx.lineTo(12, cvs.height-4);
		cvsCtx.moveTo(8, cvs.height-7);
		cvsCtx.lineTo(12, cvs.height-11);
		cvsCtx.lineTo(12, cvs.height-3);
		cvsCtx.closePath();
		cvsCtx.fill();

		/* set BackGround Color --------------------------------------------------*/
		var isReturn = objCombProc.getReturnMode();
		this.setReturnMode(isReturn);

		/* Event -----------------------------------------------------------------*/
		var self = this;
		this.cvsPbReturn.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpStartTime, e.clientX, e.clientY);	//Navigation
		};

		this.cvsPbReturn.onmouseout = function(e){
			if(isNavi) objNavi.hideMsg();							//Navigation
		};

		this.cvsPbReturn.onclick = function(){
			var isReturn = objCombProc.setReturnStateFromTranspose();
			self.setReturnMode(isReturn);
		};
	},
	/*============================================================================
	Set Return Mode
	============================================================================*/
	setReturnMode: function(isReturn){
		if(isReturn) this.cvsPbReturn.style.backgroundColor = this.returnOnColor;
		else         this.cvsPbReturn.style.backgroundColor = this.returnOffColor;
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	PlayBack:Repeat
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	initCvsPbRepeat: function(){
		/* set element -----------------------------------------------------------*/
		this.cvsPbRepeat = document.getElementById('cvsPbRepeat');

		/* Draw Mark -------------------------------------------------------------*/
		var cvs = this.cvsPbRepeat;
		var cvsCtx = cvs.getContext('2d');
		cvsCtx.clearRect(0, 0, cvs.width, cvs.height);

		cvsCtx.fillStyle = 'black';
		//upper line
		cvsCtx.beginPath();
		cvsCtx.moveTo(8, 5);
		cvsCtx.lineTo(cvs.width-10, 5);
		cvsCtx.stroke();
		//lower line
		cvsCtx.beginPath();
		cvsCtx.moveTo(11, cvs.height-5);
		cvsCtx.lineTo(cvs.width-10, cvs.height-5);
		cvsCtx.stroke();
		//arc
		cvsCtx.beginPath();
		cvsCtx.arc(cvs.width-10, cvs.height/2, 5, Math.PI*1.5, Math.PI/2, false);
		cvsCtx.stroke();
		//Triangle
		cvsCtx.beginPath();
		cvsCtx.moveTo(6, cvs.height-5);
		cvsCtx.lineTo(11, cvs.height-8);
		cvsCtx.lineTo(11, cvs.height-2);
		cvsCtx.closePath();
		cvsCtx.fill();

		/*set backgroundColor ----------------------------------------------------*/
		var isRepeat = objCombProc.getRepeatMode();
		this.setRepeatMode(isRepeat);

		/* Event -----------------------------------------------------------------*/
		var self = this;
		this.cvsPbRepeat.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpRpt, e.clientX, e.clientY);			//Navigation
		};

		this.cvsPbRepeat.onmouseout = function(e){
			if(isNavi) objNavi.hideMsg();							//Navigation
		};

		this.cvsPbRepeat.onclick = function(){
			var isRepeat = objCombProc.setRepeatStateFromTranspose();
			self.setRepeatMode(isRepeat);
		};
	},
	/*============================================================================
	Set Repeat Mode
	============================================================================*/
	setRepeatMode: function(isRepeat){
		if(isRepeat) this.cvsPbRepeat.style.backgroundColor = this.repeatOnColor;
		else         this.cvsPbRepeat.style.backgroundColor = this.repeatOffColor;
	},


	/*****************************************************************************
	Direct Repeat Button
	*****************************************************************************/
	initDirRptBtn: function(){
		var self = this;
		var rptPart;
		$('.btnRptTp').mouseover(function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpSetRptTime, e.clientX, e.clientY);	//Navigation
		});

		$('.btnRptTp').mouseout(function(e){
			if(isNavi) objNavi.hideMsg();				//Navigation
		});

		$('.btnRptTp').click(function(){
			var idx = $('.btnRptTp').index(this);
			rptPart = objCombProc.setRptPartFromTranspose(idx);
			self.setRepeatStartTime(rptPart.stTime);
			self.setRepeatEndTime(rptPart.endTime);
		});
	},


	/*****************************************************************************
	init Display Mode
	*****************************************************************************/
	initDispMode: function(){
		/* set elements ----------------------------------------------------------*/
		this.e_btnTrDispMode = document.getElementById('btnTrDispMode');
		this.e_btnMixDispMode = document.getElementById('btnMixDispMode');
		this.e_btnFxDispMode = document.getElementById('btnFxDispMode');

		/* Event -----------------------------------------------------------------*/
		var self = this;

		//Track --------------------------------------------------------------------
		this.e_btnTrDispMode.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpTrackWnd, e.clientX, e.clientY);	//Navigation
		};
		this.e_btnTrDispMode.onmouseout = function(e){
			if(isNavi) objNavi.hideMsg();									//Navigation
		};

		this.e_btnTrDispMode.onclick = function(){
			objCombProc.switchDispMode('Track');
		};
		
		//Mixer --------------------------------------------------------------------
		this.e_btnMixDispMode.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpMixerWnd, e.clientX, e.clientY);	//Navigation
		};

		this.e_btnMixDispMode.onmouseout = function(e){
			if(isNavi) objNavi.hideMsg();									//Navigation
		};

		this.e_btnMixDispMode.onclick = function(){
			objCombProc.switchDispMode('Mixer');
		};

		//Effector -----------------------------------------------------------------
		this.e_btnFxDispMode.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tpEffectWnd, e.clientX, e.clientY);	//Navigation
		};

		this.e_btnFxDispMode.onmouseout = function(e){
			if(isNavi) objNavi.hideMsg();									//Navigation
		};

		this.e_btnFxDispMode.onclick = function(){
			objCombProc.switchDispMode('FX');
		};
	},
};	//EOF objTranspose



/*******************************************************************************
Inspector
*******************************************************************************/
var objInspector = {
	actSrc:    null, //object source for linkage process(ie. Mixer -> CombProc -> Track, FX and so on) 
	btnColors: null,	//for Mute/Solo, Automation Rec/Play

	imgIcn:   null,		//image element
	spnTrTag: null,		//span element

	enum_AM: null,		//automation type - index

	navType: null,		//Navigation Type
	/*============================================================================
	init
	============================================================================*/
	init: function(){
		/* Init Event & Navigation -----------------------------------------------*/
		this.initEvent();
		this.navType = objNavi.getNavType();

		/* Init image and span ---------------------------------------------------*/
		this.imgIcn = document.getElementById('imgIcnInspct');
		this.spnTrTag = document.getElementById('spnTrTagInspct');

		/* Set initial value -------------------------------------------------*/
		var initVal = objCombProc.getPanGainChModeFromSounds(this.actSrc, null);
		this.setPanGainChModeToInspector(initVal.pan, initVal.gain, initVal.chMode, initVal.stateAM, initVal.imgSrc, initVal.trColor, initVal.trName);
	},
	/*============================================================================
	Init Event
	============================================================================*/
	initEvent: function(){
		var actSources = objCombProc.getActSrc();
		this.actSrc = actSources.inspector;						//object source for linkage process(ie. Mixer -> CombProc -> Track, FX and so on) 
		this.enum_AM = objCombProc.getEnumAM();				//the relation param and index  
		this.btnColors = objCombProc.getBtnColors();	//button colors for M,S,P,R

		var self = this;
		$(function(){
			/* Gain ----------------------------------------------------------------*/
			//Navigation
			$('#rngGainInspct').on('mouseover', function(e){
				if(isNavi) objNavi.dispMsg(self.navType.gain, e.clientX, e.clientY);
			});
			$('#rngGainInspct').on('mouseout', function(e){
				if(isNavi) objNavi.hideMsg();
			});

			//Manual operatiing
			$('#rngGainInspct').on('mousedown', function(){
				objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.vol, true);	//manual operating
			});
			$('#rngGainInspct').on('mouseup', function(){
				objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.vol, false);	//end of manual operating 
			});

			//Value
			$('#rngGainInspct').on('input', function(){
				objCombProc.setGainFromITMF(self.actSrc, null, parseFloat(this.value));
			});


			/* Pan -----------------------------------------------------------------*/
			//Navigation
			$('#rngPanInspct').on('mouseover', function(e){
				if(isNavi) objNavi.dispMsg(self.navType.pan, e.clientX, e.clientY);
			});
			$('#rngPanInspct').on('mouseout', function(e){
				if(isNavi) objNavi.hideMsg();
			});

			//Manual operating
			$('#rngPanInspct').on('mousedown', function(){
				objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.pan, true);	//manual operating
			});
			$('#rngPanInspct').on('mouseup', function(){
				objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.pan, false);	//end of manual operating 
			});

			$('#rngPanInspct').on('input', function(){
				objCombProc.setPanFromITMF(self.actSrc, null, parseFloat(this.value));
			});


			/* Pan center ----------------------------------------------------------*/
			//Navigation
			$('#btnCenterInspct').on('mouseover', function(e){
				if(isNavi) objNavi.dispMsg(self.navType.centPan, e.clientX, e.clientY);
			});
			$('#btnCenterInspct').on('mouseout', function(e){
				if(isNavi) objNavi.hideMsg();
			});

			$('#btnCenterInspct').click(function(){
				$('#rngPanInspct').val("0");
				objCombProc.setPanFromITMF(self.actSrc, null, parseFloat(0));
			});


			/* Mute ----------------------------------------------------------------*/
			//Navigation
			$('#btnMuteInspct').on('mouseover', function(e){
				if(isNavi) objNavi.dispMsg(self.navType.mute, e.clientX, e.clientY);
			});
			$('#btnMuteInspct').on('mouseout', function(e){
				if(isNavi) objNavi.hideMsg();
			});

			$('#btnMuteInspct').click(function(){
				var chMode  = objCombProc.switchMuteFromITMF(self.actSrc , null);
				self.setBtnColorForMuteToInspector(chMode);
			});


			/* Solo ----------------------------------------------------------------*/
			//Navigation
			$('#btnSoloInspct').on('mouseover', function(e){
				if(isNavi) objNavi.dispMsg(self.navType.solo, e.clientX, e.clientY);
			});
			$('#btnSoloInspct').on('mouseout', function(e){
				if(isNavi) objNavi.hideMsg();
			});

			$('#btnSoloInspct').click(function(){
				var chMode  = objCombProc.switchSoloFromITMF(self.actSrc , null);
				self.setBtnColorForMuteToInspector(chMode);
			});


			/* Automation Rec ------------------------------------------------------*/
			//Navigation
			$('#btnRecAmInspct').on('mouseover', function(e){
				if(isNavi) objNavi.dispMsg(self.navType.amRec, e.clientX, e.clientY);
			});
			$('#btnRecAmInspct').on('mouseout', function(e){
				if(isNavi) objNavi.hideMsg();
			});

			$('#btnRecAmInspct').click(function(){
				var chMode = objCombProc.switchAmRecFromITMF(self.actSrc, null);
				self.setBtnColorForRecAmToInspector(chMode);
			});


			/* Automation Play -----------------------------------------------------*/
			//Navigation
			$('#btnPlayAmInspct').on('mouseover', function(e){
				if(isNavi) objNavi.dispMsg(self.navType.amPlay, e.clientX, e.clientY);
			});
			$('#btnPlayAmInspct').on('mouseout', function(e){
				if(isNavi) objNavi.hideMsg();
			});

			$('#btnPlayAmInspct').click(function(){
				var chMode = objCombProc.switchAmPlayFromITMF(self.actSrc, null);
				self.setBtnColorForPlayAmToInspector(chMode);
			});


			/* e(Effect) -----------------------------------------------------------*/
			//Navigation
			$('#btnFxInspct').on('mouseover', function(e){
				if(isNavi) objNavi.dispMsg(self.navType.effect, e.clientX, e.clientY);
			});
			$('#btnFxInspct').on('mouseout', function(e){
				if(isNavi) objNavi.hideMsg();
			});

			$('#btnFxInspct').click(function(){
				objCombProc.switchEffectFromITMF(self.actSrc, null);
			});

		});
	},
	/*============================================================================
	Set Gain Value to Inspector
	============================================================================*/
	setGainToInpsector: function(gain){
		$('#rngGainInspct').val( String(gain) );
	},
	/*============================================================================
	play Automation Gain To Inspector
	============================================================================*/
	playAmGainToInspector: function(gain){
		this.setGainToInpsector(gain);
	},
	/*============================================================================
	Set Pan Value to Inspector
	============================================================================*/
	setPanToInpsector: function(pan){
		$('#rngPanInspct').val( String(pan) );
	},
	/*============================================================================
	play Automation Pan To Inspector
	============================================================================*/
	playAmPanToInspector: function(pan){
		this.setPanToInpsector(pan);
	},
	/*============================================================================
	Set Button Color for Mute To Inspector
	============================================================================*/
	setBtnColorForMuteToInspector: function(chMode){
		this.cmnProcToSetBtnColorOfMuteSolo(chMode);
	},
	/*============================================================================
	Set Button Color for Solo To Inspector
	============================================================================*/
	setBtnColorForSoloToInspector: function(chMode){
		this.cmnProcToSetBtnColorOfMuteSolo(chMode);
	},
	/*----------------------------------------------------------------------------
	common proc to set button color of Mute / Solo
	----------------------------------------------------------------------------*/
	cmnProcToSetBtnColorOfMuteSolo: function(chMode){
		switch(chMode){
			case 'solo':
				$('#btnSoloInspct').css('background-color', this.btnColors.solo);
				$('#btnMuteInspct').css('background-color', this.btnColors.norm);
				break;
			case 'mute':
				$('#btnMuteInspct').css('background-color', this.btnColors.mute);
				$('#btnSoloInspct').css('background-color', this.btnColors.norm);
				break;
			default:
				$('#btnSoloInspct').css('background-color', this.btnColors.norm);
				$('#btnMuteInspct').css('background-color', this.btnColors.norm);
			break;
		}
	},
	/*============================================================================
	Set Button Color for Rec Automation To Inspector
	============================================================================*/
	setBtnColorForRecAmToInspector: function(chModeAM){
		this.cmnProcToSetBtnColorOfRecPlayAM(chModeAM);
	},
	/*============================================================================
	Set Button Color for Play Automation To Inspector
	============================================================================*/
	setBtnColorForPlayAmToInspector: function(chModeAM){
		this.cmnProcToSetBtnColorOfRecPlayAM(chModeAM);
	},
	/*----------------------------------------------------------------------------
	common proc to set button color of Mute / Solo
	----------------------------------------------------------------------------*/
	cmnProcToSetBtnColorOfRecPlayAM: function(chModeAM){
		switch(chModeAM){
			case 'rec':
				$('#btnRecAmInspct').css('background-color', this.btnColors.recAM);
				$('#btnPlayAmInspct').css('background-color', this.btnColors.norm);
				break;
			case 'play':
				$('#btnRecAmInspct').css('background-color', this.btnColors.norm);
				$('#btnPlayAmInspct').css('background-color', this.btnColors.playAM);
				break;
			default:
				$('#btnRecAmInspct').css('background-color', this.btnColors.norm);
				$('#btnPlayAmInspct').css('background-color', this.btnColors.norm);
			break;
		}
	},
	/*============================================================================
	Set Pan, Gain, Ch mode to Inspector
	============================================================================*/
	setPanGainChModeToInspector: function(pan, gain, muteSolo, recPlayAM, imgSrc, trColor, trName){
		this.setGainToInpsector(gain);										//gain
		this.setPanToInpsector(pan);											//pan
		this.cmnProcToSetBtnColorOfMuteSolo(muteSolo);		//Mute/Solo
		this.cmnProcToSetBtnColorOfRecPlayAM(recPlayAM);	//Automation Rec/Play

		//set Icon and BackgroundColor
		this.imgIcn.src = imgSrc;
		this.imgIcn.style.backgroundColor = trColor;

		//set Track Name
		this.spnTrTag.innerHTML = trName;
		this.spnTrTag.style.backgroundColor = trColor;
	},
	/*============================================================================
	Set Button Color For Norm To Inspector
	============================================================================*/
	setBtnColorForNormToInspector: function(){
		this.cmnProcToSetBtnColorOfMuteSolo('norm');
	},
};	//EOF objInspector



/*******************************************************************************
Track
*******************************************************************************/
var objTrack  = {
	prjMaxTime: 180,	//prject Maximum time(sec) for canvas in Tr view, time ruler and AM edit

	/* Navigation --------------------------------------------------------------*/
	navType: null,

	/* Cross Browser -----------------------------------------------------------*/
	isMacFirefox: false,	//true: use .blur() in <select>, false: no-usage .blur() in <select>

	/* Sounds param for drawing wave -------------------------------------------*/
	numTracks: null,
	partChNames: null,
	trackColors: null,
	duration: [],	//each audio duration
	wavData: [],	//each audio wav data
	startPos: [],	//each audio start position

	/* Automation for common ---------------------------------------------------*/
	typeAM:     null,	//Automation type for <select>
	infoAM:     null,	//Automation select, min/max value and text, digit, value step  
	maxAmVal:   null,	//max of Automation value
	isDispAmTr: null,	//display Automation Track View or not for each Ch 
	currAmMode: null,	//Off, Del, Add, Move, Edit for each Ch
	bgcModeAM: {
		bgcDef:    'black',
		bgcOff:    'white',
		bgcDel:    'lightCoral',
		bgcAdd:    'lightskyblue',
		bgcMove:   'lightgreen',
		bgcEdit:   'orange',
		txcDel:    '#CC0000',				//Red
		txcAdd:    '#0000FF',				//Blue
		txcMove:   '#00A000',				//Green
		txcEdit:   '#DF7500',				//Orange
		modeOff:   'off',
		modeDel:   'del',
		modeAdd:   'add',
		modeMove:  'move',
		modeEdit:  'edit',
	},
	//for Move/Edit mode to draw AM pixel data 
	bufAmStartIdx: null,	//index of target AM data at first time 
	bufAmCurrIdx:  null,	//index of target AM data at first time 
	bufAmTime:     null,	//AM draw data for time
	bufAmVal:      null,	//AM draw data for value
	bufChAM:       null,	//Array buffer for each Track in Move & Edit mode 

	/* Time Ruler & Track View -------------------------------------------------*/
	scrolEndMrgn:  null,	//End scroll margine

	/* Time Ruler --------------------------------------------------------------*/
	e_divTimeRuler: null,
	e_cvsTimeRuler: null,
	e_cvsRepeatMarkerL: null,
	e_cvsRepeatMarkerR: null,
	e_cvsRepeatRegion: null,
	timeRepeatMarkerL: null,	//use this time to change horizontal scale
	timeRepeatMarkerR: null,	//use this time to change horizontal scale

	/* Track Ch ----------------------------------------------------------------*/
	actSrc:    null, //object source for linkage process(ie. Track -> CombProc -> Mixer, FX and so on) 
	btnColors: null, //button colors for M,S,P,R

	name_trTrCh: 		'trTrCh',
	name_tdTrCh: 		'tdTrCh',
	name_imgIcon: 	'imgTrCh',
	name_spnTag: 		'tagTrCh',
	name_cvsAmTrCh: 'cvsAmTrCh',
	name_btnMute: 	'btnMuteTrCh',
	name_btnSolo: 	'btnSoloTrCh',
	name_btnPlayAM: 'btnPlayAmTrCh',
	name_btnRecAM: 	'btnRecAmTrCh',
	name_btnEffect: 'btnEffectTrCh',
	//Automation
	name_trAmCh:         'trAmCh',
	name_tdAmCh:         'tdAmCh',
	name_btnAmZmUp:      'btnAmZmUp',			//Zoom Up
	name_btnAmZmDwn:     'btnAmZmDwn',		//Zoom Down
	name_spnAmTag:       'spnAmTag',
	name_slctAmType:     'slctAmType',		//Automation Type
	name_spnAmTimeTag:   'spnAmTimeTag',
	name_spnAmMin:       'spnAmMin',
	name_cvsAmMin:       'cvsAmMin',
	name_spnAmMinSecTag: 'spnAmMinSecTag',
	name_spnAmSec:       'spnAmSec',
	name_cvsAmSec:       'cvsAmSec',
	name_spnAmSecMsecTag:'spnAmSecMsecTag',
	name_spnAmMsec:      'spnAmMsec',
	name_cvsAmMsec:      'cvsAmMsec',
	name_spnAmValTag:    'spnAmValTag',
	name_spnAmVal:       'spnAmVal',
	name_cvsAmVal:       'cvsAmVal',
	name_btnAmDel:       'btnAmDel',
	name_btnAmAdd:       'btnAmAdd',
	name_btnAmMove:      'btnAmMove',
	name_btnAmEdit:      'btnAmEdit',
	name_spnAmValLbl:    'spnAmValLbl',

	e_divTrCh:    null,
	e_trAmCh:     null,	//<tr> for Automation <canvas>
	e_cvsAmTrCh:  null,	//
	e_slctAmType: null,	//<select> for Automation Type
	e_spnAmMin:   null,	//<span> for Automation Time 'Min'
	e_spnAmSec:   null,	//<span> for Automation Time 'Sec'
	e_spnAmMsec:  null,	//<span> for Automation Time 'Msec'
	e_spnAmVal:   null,	//<span> for Automation Value
	e_cvsAmMin:   null,	//<canvas> for Automation Time 'Min'
	e_cvsAmSec:   null,	//<canvas> for Automation Time 'Sec'
	e_cvsAmMsec:  null,	//<canvas> for Automation Time 'Msec'
	e_btnAmDel:   null, //<button> for Automation Mode 'Delete'
	e_btnAmAdd:   null, //<button> for Automation Mode 'Add'
	e_btnAmMove:  null, //<button> for Automation Mode 'Move'
	e_btnAmEdit:  null, //<button> for Automation Mode 'Edit'
	deltaTdHeight: 20,	//Zoom up / down size for Automation Tr Ch / View
	maxTdHeight:  260,	//Zoom up / down max size for Automation Tr Ch / View
	minTdHeight:   60,	//Zoom up / down min size for Automation Tr Ch / View

	colorFocusOn: null,	//mouse over on Time & Value of Tr Ch. in Edit mode
	colorFocusOff: null,
	dndEvts:  [],				//Drag and Drop events for Tr Ch. AM time and value

	strAmTimeValTop: '22px',	//<canvas> top(px) for Tr Ch. AM time and value 
	bufAmDatInDnD: null,			//buffer Automation data(min, sec, msec, value) in Drag and Drop
	bufDndVal:  	 null,			//buffer start datum before drag event


	/* Track view --------------------------------------------------------------*/
	name_trTrView:  'trTrView',
	name_tdTrView:  'tdTrView',
	name_cvsTrView: 'cvsTrView',
	//Automation
	name_trAmView:  'trAmView',
	name_tdAmView:  'tdAmView',
	name_cvsTrAmBg: 'cvsTrAmBg',
	name_cvsTrAm:   'cvsTrAm',

	e_divTrView: null,
	e_divTrView_positionX: null,
	e_trAmView:    null,
	e_cvsWavForm:  null,
	e_cvsAmBgForm: null,
	e_cvsAmForm:   null,
	mrkSide:       10,		//height / width of Automation marker
	mrkSeekRng:    0.1,		//seeking range for target in Tr View 

	/* play line ---------------------------------------------------------------*/
	e_tabTrView: null,
	e_cvsPlayLine: null,

	/* scroll bar --------------------------------------------------------------*/
	e_cvsTrScrollX: null,
	e_divTrScrollX: null,
	e_cvsTrScrollY: null,
	e_divTrScrollY: null,
	rngScrollX: null,
	rngScrollY: null,
	dndScrlEvt: [],

	/* zoom up down for horizontal ---------------------------------------------*/
	currPxPerSec: 3,
	e_btnAutoScrollX: null,
	e_btnMagX: null,
	e_btnRedX: null,
	isAutoScrollX: false,

	/* All Part Ch Mute / Solo -------------------------------------------------*/
	e_btnAllPartChMuteState: null,
	e_btnAllPartChSoloState: null,
	isAllPartChSoloState:    null,
	isAllPartChMuteState:    null,

	/* init ====================================================================*/
	init : function(){
		this.prjMaxTime = objCombProc.getPrjMaxTime();		//project maximum time
		this.navType = objNavi.getNavType();							//Navigation Type
		this.trackColors = objCombProc.getPartChColor();	//tack color
		this.partChNames = objCombProc.getChNames();			//Part Ch name
		this.numTracks = objCombProc.getSoundsNum();			//num of Part Ch
		this.duration = new Array(this.numTracks);				//each audio duration
		this.wavData = new Array(this.numTracks);					//each audio wave data
		this.startPos = new Array(this.numTracks);				//each audio start position
		this.scrolEndMrgn = this.mrkSide;

		/* Automation for common -------------------------------------------------*/
		this.initAmForCmn();

		/* Time Ruler ------------------------------------------------------------*/
		this.initTimeRuler();

		/* Repeat Marker ---------------------------------------------------------*/
		this.initRptMarker();

		/* Track Ch --------------------------------------------------------------*/
		this.initTrackCh();

		/* Auto Scroll & Zoom ----------------------------------------------------*/
		this.initAutoScrollAndZoom();

		/* All Part Ch Mute / Solo -----------------------------------------------*/
		this.initAllPartChMuteSolo();

		/* Track View ------------------------------------------------------------*/
		this.initTrackView();

		/* Play Line -------------------------------------------------------------*/
		this.initPlayLine();
	},	//EOF init

	/*****************************************************************************
	Automation for common
	*****************************************************************************/
	initAmForCmn: function(){
		//Automation Type for <select>
		this.typeAM = objCombProc.getTypeAM();
		
		//Automation info:min/max val, background color
		this.infoAM = objCombProc.getInfoAM();
		
		//get maximum number of val in infoAM
		for(var i=0, len=this.infoAM.length; i<len; i++){
			if(i === 0){
				this.maxAmVal = this.infoAM[i].val.length;
			}else{
				if(this.maxAmVal < this.infoAM[i].val.length) this.maxAmVal = this.infoAM[i].val.length; 
			}
		}
		
		//Disply Automation Track View for each Ch
		this.isDispAmTr = new Array(this.numTracks);
		for(var i=0; i<this.numTracks; i++){
			this.isDispAmTr[i] = false;
		}

		//Automation Mode for each Ch - Off, Del, Add, Move, Edit
		this.currAmMode = new Array(this.numTracks);

		//buffer chAM for Move & Edit mode
		this.bufChAM = new Array(this.numTracks);
		for(var i=0; i<this.numTracks; i++){
			this.bufChAM[i] = {
				startIdx: null,		//index of target AM data at first time
				currIdx: null,		//current index of target AM data
				time: null,				//AM draw data for time in Move & Edit mode
				val: null,					//AM draw data for val in Move & Edit mode
				isClick: null,		//true: clicked for Drag & Drop in AM Mode Edit
			};
		}
	},


	/*****************************************************************************
	Time Ruler
	*****************************************************************************/
	initTimeRuler: function(){
		/* make Time Ruler Elements ----------------------------------------------*/
		this.makeTimeRulerElements();
		
		/* Event: change Play Line and Repeat Marker -----------------------------*/
		this.evtChgPlayLineAndRptMarker();
	},
	/*============================================================================
	make time ruler elements
	============================================================================*/
	makeTimeRulerElements: function(){
		$('<tr></tr>')
			.attr("id", "trTimeRuler")
			.appendTo("#tabTimeRuler");
		$('<td></td>')
			.attr("id", "tdTimeRuler")
			.css({'position':'relative'})
			.appendTo("#trTimeRuler");
		$('<canvas></canvas>')
			.attr("id", "cvsTimeRuler")
			.attr("width", String(this.currPxPerSec*this.prjMaxTime + this.scrolEndMrgn)+"px")
			.attr("height", "40px")
			.appendTo("#tdTimeRuler");
		$('<canvas></canvas>')
			.attr("id", "cvsRepeatMarkerL")
			.attr("width", "15px")
			.attr("height", "15px")
			.appendTo("#tdTimeRuler");
		$('<canvas></canvas>')
			.attr("id", "cvsRepeatMarkerR")
			.attr("width", "15px")
			.attr("height", "15px")
			.appendTo("#tdTimeRuler");
		$('<canvas></canvas>')
			.attr("id", "cvsRepeatRegion")
			.attr("width", "0px")
			.attr("height", "5px")
			.appendTo("#tdTimeRuler");

		/* Set each element to variant -------------------------------------------*/
		this.e_divTimeRuler = document.getElementById('divTimeRuler');
		this.e_cvsTimeRuler = document.getElementById('cvsTimeRuler');
		this.e_cvsRepeatMarkerL = document.getElementById('cvsRepeatMarkerL');
		this.e_cvsRepeatMarkerR = document.getElementById('cvsRepeatMarkerR');
		this.e_cvsRepeatRegion = document.getElementById('cvsRepeatRegion');
	},
	/*============================================================================
	EVENT: change Play Line and Repeat Marker
	============================================================================*/
	evtChgPlayLineAndRptMarker: function(){
		/* change play line or Repeat Marker position on Time Ruler ----------*/
		var self = this;
		//Navigation
		self.e_cvsTimeRuler.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.timeRuler, e.clientX, e.clientY);
		};
		self.e_cvsTimeRuler.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};

		self.e_cvsTimeRuler.onclick = function(e){
			var assignedPos = e.clientX + self.e_divTrView.scrollLeft - self.e_divTrView_positionX;
			if(assignedPos < self.mrkSide/2) assignedPos = self.mrkSide/2;
			if(e.metaKey || e.ctrlKey){
				//Repeat Start Position and Time
				self.e_cvsRepeatMarkerL.style.left = assignedPos + 'px';
				// self.timeRepeatMarkerL = assignedPos / self.currPxPerSec;
				self.timeRepeatMarkerL = (assignedPos-self.mrkSide/2) / self.currPxPerSec;
				self.setRepeatRegion();
				objCombProc.setRepeatStartTimeFromTrack(self.timeRepeatMarkerL);
			}else if(e.altKey){
				//Repeat End Position and Time
				// if(assignedPos < self.e_cvsRepeatMarkerR.width) self.e_cvsRepeatMarkerR.style.left = self.e_cvsRepeatMarkerR.width + 'px'; //Prevention for Right Marker out of Time Ruler's left side
				// else self.e_cvsRepeatMarkerR.style.left = assignedPos - self.e_cvsRepeatMarkerR.width + 'px';
				self.e_cvsRepeatMarkerR.style.left = assignedPos - self.e_cvsRepeatMarkerR.width + 'px';
				// self.timeRepeatMarkerR = assignedPos / self.currPxPerSec;
				self.timeRepeatMarkerR = (assignedPos-self.mrkSide/2) / self.currPxPerSec;
				self.setRepeatRegion();
				objCombProc.setRepeatEndTimeFromTrack(self.timeRepeatMarkerR);
			}else{
				//Play Line Position
				self.setPlayLinePosAndPlayTime(assignedPos);
			}
		};
	},
	/*============================================================================
	Common proc for e_cvsTimerRuler and e_cvsWavForm
	============================================================================*/
	setPlayLinePosAndPlayTime: function(assignedPos){
		// var assignedTime = assignedPos / this.currPxPerSec;
		var assignedTime = (assignedPos - this.mrkSide/2) / this.currPxPerSec;
		this.e_cvsPlayLine.style.left = assignedPos + 'px';
		objCombProc.setPlayPosFromTrack(assignedTime);
	},



	/*****************************************************************************
	Repeat Marker
	*****************************************************************************/
	initRptMarker: function(){
		var initMarkerTimes = objCombProc.getRepeatStartEndTime();
		this.timeRepeatMarkerL = initMarkerTimes.repeatStartTime;
		this.timeRepeatMarkerR = initMarkerTimes.repeatEndTime,
		
		/* draw Repeat Markers ---------------------------------------------------*/
		this.drawRepeatMarkers();

		/* Navigation for Repeat Markers -----------------------------------------*/
		this.naviForRepeatMarkers();

		/* Repeat region - show or hidden ----------------------------------------*/
		this.setRepeatMode(objCombProc.getRepeatMode());

		/* Locate repeat marker and region ---------------------------------------*/
		this.locateRepeatMarkerAndRegion();
	},
	/*============================================================================
	draw Repeat Markers
	============================================================================*/
	drawRepeatMarkers: function(){
		var cvs, cvsCtx;
		for(i=0; i<2; i++){
			if(i === 0) cvs = this.e_cvsRepeatMarkerL;
			else cvs = this.e_cvsRepeatMarkerR;
			cvsCtx = cvs.getContext('2d');
			cvsCtx.clearRect(0, 0, cvs.width, cvs.height);
			cvsCtx.fillStyle = 'white';
			cvsCtx.beginPath();
			cvsCtx.moveTo(0, 0);
			cvsCtx.lineTo(cvs.width, 0);
			if(i === 0) cvsCtx.lineTo(0, cvs.height);
			else cvsCtx.lineTo(cvs.width, cvs.height);
			cvsCtx.closePath();
			cvsCtx.fill();
		}
	},
	/*============================================================================
	Navigation for Repeat Markers
	============================================================================*/
	naviForRepeatMarkers: function(){
		var self = this;
		//Repeat Start Mark
		this.e_cvsRepeatMarkerL.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tmRlrRptStartMrk, e.clientX, e.clientY);
		};
		this.e_cvsRepeatMarkerL.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};

		//Repeat End Mark
		this.e_cvsRepeatMarkerR.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.tmRlrRptEndMrk, e.clientX, e.clientY);
		};
		this.e_cvsRepeatMarkerR.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};
	},
	/*============================================================================
	Repeat Region - show or hidden
	============================================================================*/
	setRepeatMode: function(isRepeat){
		if(isRepeat) this.e_cvsRepeatRegion.style.display = 'block';
		else this.e_cvsRepeatRegion.style.display = 'none';
	},
	/*============================================================================
	Set Repeat Region

	Notice!
	.offsetLeft doesn't work in display:none then use .style.left and parseFloat / parseInt. 
	============================================================================*/
	setRepeatRegion: function(){
		//console.log('setRepeatRegion @ objTrack')
		if(this.timeRepeatMarkerR > this.timeRepeatMarkerL){
			// this.e_cvsRepeatRegion.style.left = this.e_cvsRepeatMarkerL.offsetLeft + 'px';
			// this.e_cvsRepeatRegion.width = this.e_cvsRepeatMarkerR.offsetLeft - this.e_cvsRepeatMarkerL.offsetLeft + this.e_cvsRepeatMarkerR.width;
			// console.log(this.e_cvsRepeatMarkerL.offsetLeft); //0 in display:none
			this.e_cvsRepeatRegion.style.left = this.e_cvsRepeatMarkerL.style.left;
			this.e_cvsRepeatRegion.width = parseFloat(this.e_cvsRepeatMarkerR.style.left) - parseFloat(this.e_cvsRepeatMarkerL.style.left) + this.e_cvsRepeatMarkerR.width;
			this.e_cvsRepeatRegion.style.backgroundColor = 'lightblue';
		}else{
			// this.e_cvsRepeatRegion.style.left = this.e_cvsRepeatMarkerR.offsetLeft + this.e_cvsRepeatMarkerR.width + 'px';
			// var regionWidth = this.e_cvsRepeatMarkerL.offsetLeft - this.e_cvsRepeatMarkerR.offsetLeft - this.e_cvsRepeatMarkerR.width;
			this.e_cvsRepeatRegion.style.left = String(parseFloat(this.e_cvsRepeatMarkerR.style.left) + this.e_cvsRepeatMarkerR.width) + 'px';
			var regionWidth = parseFloat(this.e_cvsRepeatMarkerL.style.left) - parseFloat(this.e_cvsRepeatMarkerR.style.left) - this.e_cvsRepeatMarkerR.width + 1; //+1:adjust for parseFloat
			if(regionWidth < 0) regionWidth = 0;				//minus value is invalid for width of element
			this.e_cvsRepeatRegion.width = regionWidth;
			this.e_cvsRepeatRegion.style.backgroundColor = 'pink';
		}
	},
	/*============================================================================
	Locate repeat marker and region
	============================================================================*/
	locateRepeatMarkerAndRegion: function(){
		// this.e_cvsRepeatMarkerL.style.left = this.timeRepeatMarkerL * this.currPxPerSec + 'px';
		// this.e_cvsRepeatMarkerR.style.left = this.timeRepeatMarkerR * this.currPxPerSec - this.e_cvsRepeatMarkerR.width + 'px';
		this.e_cvsRepeatMarkerL.style.left = this.timeRepeatMarkerL * this.currPxPerSec + this.mrkSide/2 + 'px';
		this.e_cvsRepeatMarkerR.style.left = this.timeRepeatMarkerR * this.currPxPerSec + this.mrkSide/2 - this.e_cvsRepeatMarkerR.width + 'px';

		this.setRepeatRegion();
	},
	/*============================================================================
	Set Repeat Start time
	============================================================================*/
	setRepeatStartTimeToTrack: function(startTime){
		this.timeRepeatMarkerL = startTime;
		this.locateRepeatMarkerAndRegion();
	},
	/*============================================================================
	Set Repeat End time
	============================================================================*/
	setRepeatEndTimeToTrack: function(endTime){
		this.timeRepeatMarkerR = endTime;
		this.locateRepeatMarkerAndRegion();
	},



	/*****************************************************************************
	Track Ch
	*****************************************************************************/
	initTrackCh: function(){
		/* make Track Ch Elements ------------------------------------------------*/
		this.makeTrackChElements();

		/* EVENT: set Mute,Solo,Play,Rec,e ---------------------------------------*/
		this.evtSetMSPRE();

		/* AM EVENT: Automation Buttun -------------------------------------------*/
		this.evtAmBtn();

		/* AM EVENT: select Automation Type --------------------------------------*/
		this.evtSlctAmType();

		/* AM EVENT: Zoom Up / Down Automation Track Ch and View -----------------*/
		this.evtZmUpDwnAmTrChView();

		/* AM EVENT: change Automation Mode --------------------------------------*/
		this.evtChgAmMode();

		/* AM EVENT: change Automation data with Drag & Drop ---------------------*/
		this.evtChgAmDatDnD();
	},
	/*============================================================================
	make Track Ch Elements
	============================================================================*/
	makeTrackChElements: function(){
		var self = this;
		var len_typeAM = self.typeAM.length;
		//Icon for Part Ch
		var imgPath = objCombProc.getImgPath();
		var imgDir = imgPath.dir;
		var imgFiles = imgPath.files;
		//parent / children elements
		var trTrCh;
		var trID;
		var tdID;
		for(var i=0; i<self.numTracks; i++){
			/* Track Ch ------------------------------------------------------------*/
			trID = self.name_trTrCh + String(i);
			tdID = self.name_tdTrCh + String(i);
			$('<tr></tr>')
				.attr("class", self.name_trTrCh)
				.attr("id", trID)
				.appendTo("#tabTrCh");
			$('<td></td>')
				.attr("class", self.name_tdTrCh)
				.attr("id", tdID)
				.appendTo("#" + trID);
			//Part icon
			$('<img></img>')
				.attr("class", self.name_imgIcon)
				.attr("id", self.name_imgIcon + String(i))
				.attr("src", imgDir+"/"+imgFiles[i])
				.attr("alt", "No image")
				.css('background-color', self.trackColors[i])
				.appendTo("#" + tdID);
			//Part name
			$('<span></span>')
				.attr("id", self.name_spnTag + String(i))
				.attr("class", self.name_spnTag)
				.text(self.partChNames[i])
				.css('background-color', self.trackColors[i])
				.appendTo("#" + tdID);
			//Automation button
			$('<canvas></canvas>')
				.attr("id", self.name_cvsAmTrCh + String(i))
				.attr("class", self.name_cvsAmTrCh)
				.attr("width", "28px")
				.attr("height", "20px")
				.appendTo("#" + tdID);
			//Mute button
			$('<input type="button" />')
				.attr("id", self.name_btnMute + String(i))
				.attr("class", self.name_btnMute)
				.attr("value", "M")
				.appendTo("#" + tdID);
			//Solo button
			$('<input type="button" />')
				.attr("id", self.name_btnSolo + String(i))
				.attr("class", self.name_btnSolo)
				.attr("value", "S")
				.appendTo("#" + tdID);
			//Play AutoMation
			$('<input type="button" />')
				.attr("id", self.name_btnPlayAM + String(i))
				.attr("class", self.name_btnPlayAM)
				.attr("value", "P")
				.appendTo("#" + tdID);
			//Rec AutoMation
			$('<input type="button" />')
				.attr("id", self.name_btnRecAM + String(i))
				.attr("class", self.name_btnRecAM)
				.attr("value", "R")
				.appendTo("#" + tdID);
			//Effect
			$('<input type="button" />')
				.attr("id", self.name_btnEffect + String(i))
				.attr("class", self.name_btnEffect)
				.attr("value", "e")
				.appendTo("#" + tdID);
			/* Automation ----------------------------------------------------------*/
			trID = self.name_trAmCh + String(i);
			tdID = self.name_tdAmCh + String(i);
			$('<tr></tr>')
				.attr("class", self.name_trAmCh)
				.attr("id", trID)
				.css('display','none')
				.appendTo("#tabTrCh");
			$('<td></td>')
				.attr("class", self.name_tdAmCh)
				.attr("id", tdID)
				.appendTo("#" + trID);
			//Zoom Up
			$('<input type="button" />')
				.attr("id", self.name_btnAmZmUp + String(i))
				.attr("class", self.name_btnAmZmUp)
				.attr('value', '+')
				.appendTo("#" + tdID);
			//Zoom Down
			$('<input type="button" />')
				.attr("id", self.name_btnAmZmDwn + String(i))
				.attr("class", self.name_btnAmZmDwn)
				.attr('value', '-')
				.appendTo("#" + tdID);
			//Span - Automation Tag
			$('<span></span>')
				.attr("id", self.name_spnAmTag + String(i))
				.attr("class", self.name_spnAmTag)
				.text('TYPE')
				.appendTo("#" + tdID);
			//select
			$('<select></select>')
				.attr("id", self.name_slctAmType + String(i))
				.attr("class", self.name_slctAmType)
				.appendTo("#" + tdID);
				for(var j=0; j<len_typeAM; j++){
					$("#"+self.name_slctAmType + String(i)).append($("<option>").val(String(j)).text(self.typeAM[j]));
				}
			//Span - Time Tag
			$('<span></span>')
				.attr("id", self.name_spnAmTimeTag + String(i))
				.attr("class", self.name_spnAmTimeTag)
				.text('Time')
				.appendTo("#" + tdID);
			//Span - Min
			$('<span></span>')
				.attr("id", self.name_spnAmMin + String(i))
				.attr("class", self.name_spnAmMin)
				.text('00')
				.appendTo("#" + tdID);
			//Canvas - Min
			$('<canvas></canvas>')
				.attr("id", self.name_cvsAmMin + String(i))
				.attr("class", self.name_cvsAmMin)
				.attr("width", "23px")
				.attr("height", "17px")
				.appendTo("#" + tdID);
			//Span - : between Min and Sec
			$('<span></span>')
				.attr("id", self.name_spnAmMinSecTag + String(i))
				.attr("class", self.name_spnAmMinSecTag)
				.text(':')
				.appendTo("#" + tdID);
			//Span - Sec
			$('<span></span>')
				.attr("id", self.name_spnAmSec + String(i))
				.attr("class", self.name_spnAmSec)
				.text('00')
				.appendTo("#" + tdID);
			//Canvas - Sec
			$('<canvas></canvas>')
				.attr("id", self.name_cvsAmSec + String(i))
				.attr("class", self.name_cvsAmSec)
				.attr("width", "23px")
				.attr("height", "17px")
				.appendTo("#" + tdID);
			//Span - : between Sec and Msec
			$('<span></span>')
				.attr("id", self.name_spnAmSecMSecTag + String(i))
				.attr("class", self.name_spnAmSecMsecTag)
				.text(':')
				.appendTo("#" + tdID);
			//Span - Msec
			$('<span></span>')
				.attr("id", self.name_spnAmMsec + String(i))
				.attr("class", self.name_spnAmMsec)
				.text('000')
				.appendTo("#" + tdID);
			//Canvas - Msec
			$('<canvas></canvas>')
				.attr("id", self.name_cvsAmMsec + String(i))
				.attr("class", self.name_cvsAmMsec)
				.attr("width", "30px")
				.attr("height", "17px")
				.appendTo("#" + tdID);
			//Span - Value Tag
			$('<span></span>')
				.attr("id", self.name_spnAmValTag + String(i))
				.attr("class", self.name_spnAmValTag)
				.text('Value')
				.appendTo("#" + tdID);
			//Span - Value
			$('<span></span>')
				.attr("id", self.name_spnAmVal + String(i))
				.attr("class", self.name_spnAmVal)
				.text('LowShelf')
				.appendTo("#" + tdID);
			//Canvas - Value
			$('<canvas></canvas>')
				.attr("id", self.name_cvsAmVal + String(i))
				.attr("class", self.name_cvsAmVal)
				.attr("width", "58px")
				.attr("height", "17px")
				.appendTo("#" + tdID);
			//Delete
			$('<input type="button" />')
				.attr("id", self.name_btnAmDel + String(i))
				.attr("class", self.name_btnAmDel)
				.attr('value', 'Del')
				.appendTo("#" + tdID);
			//Add
			$('<input type="button" />')
				.attr("id", self.name_btnAmAdd + String(i))
				.attr("class", self.name_btnAmAdd)
				.attr('value', 'Add')
				.appendTo("#" + tdID);
			//Move
			$('<input type="button" />')
				.attr("id", self.name_btnAmMove + String(i))
				.attr("class", self.name_btnAmMove)
				.attr('value', 'Move')
				.appendTo("#" + tdID);
			//Edit
			$('<input type="button" />')
				.attr("id", self.name_btnAmEdit + String(i))
				.attr("class", self.name_btnAmEdit)
				.attr('value', 'Edit')
				.appendTo("#" + tdID);
			//Span - Automation Values Label
			for(j=0; j<self.maxAmVal; j++){
				$('<span></span>')
					.attr("id", 'ch'+String(i)+self.name_spnAmValLbl+String(j))
					.attr("class", 'ch'+String(i)+self.name_spnAmValLbl+' '+self.name_spnAmValLbl)
					.text('Val'+String(j))
					.appendTo("#" + tdID);
			}
		}
		/* Set each element to variant -------------------------------------------*/
		self.e_divTrCh = document.getElementById('divTrCh');
		self.e_trAmCh = document.getElementsByClassName(self.name_trAmCh);
		self.e_cvsAmTrCh = document.getElementsByClassName(self.name_cvsAmTrCh);
		self.e_slctAmType = document.getElementsByClassName(self.name_slctAmType);
		self.e_spnAmMin = document.getElementsByClassName(self.name_spnAmMin);
		self.e_spnAmSec = document.getElementsByClassName(self.name_spnAmSec);
		self.e_spnAmMsec = document.getElementsByClassName(self.name_spnAmMsec);
		self.e_spnAmVal = document.getElementsByClassName(self.name_spnAmVal);
		self.e_cvsAmMin = document.getElementsByClassName(self.name_cvsAmMin);
		self.e_cvsAmSec = document.getElementsByClassName(self.name_cvsAmSec);
		self.e_cvsAmMsec = document.getElementsByClassName(self.name_cvsAmMsec);
		self.e_cvsAmVal = document.getElementsByClassName(self.name_cvsAmVal);
		self.e_btnAmDel = document.getElementsByClassName(self.name_btnAmDel);
		self.e_btnAmAdd = document.getElementsByClassName(self.name_btnAmAdd);
		self.e_btnAmMove = document.getElementsByClassName(self.name_btnAmMove);
		self.e_btnAmEdit = document.getElementsByClassName(self.name_btnAmEdit);

		/* Draw Automation Button & Set curr Automatiom Mode ---------------------*/
		for(var i=0; i<self.numTracks; i++){
			self.drawAmBtn(i);
			self.currAmMode[i] = self.bgcModeAM.modeOff;
		}
	},
	/*============================================================================
	Draw Automaton Button
	============================================================================*/
	drawAmBtn: function(idxCh){
		var cvs = this.e_cvsAmTrCh[idxCh];
		var cvsCtx = cvs.getContext('2d');
		cvsCtx.clearRect(0, 0, cvs.width, cvs.height);

		cvsCtx.strokeStyle = 'black'; 
		cvsCtx.lineWidth = 1;
		cvsCtx.beginPath();
		if(this.e_trAmCh[idxCh].style.display === 'none'){
			//draw a lower triangle
			cvsCtx.moveTo(7, 5);
			cvsCtx.lineTo(cvs.width-7, 5);
			cvsCtx.lineTo(cvs.width/2, cvs.height-5);
		}else{
			//draw a upper triangle
			cvsCtx.moveTo(cvs.width/2, 5);
			cvsCtx.lineTo(7, cvs.height-5);
			cvsCtx.lineTo(cvs.width-7, cvs.height-5);
		}
		cvsCtx.closePath();
		cvsCtx.fill();
	},


	/*============================================================================
	EVENT: set Mute,Solo,Play,Rec,e(effect)
	============================================================================*/
	evtSetMSPRE: function(){
		//get object sources
		var actSources = objCombProc.getActSrc();
		this.actSrc = actSources.track;
		//get button colors
		this.btnColors = objCombProc.getBtnColors();

		var self = this;
		$(function(){
			/* Icon ----------------------------------------------------------------*/
			//Navigation
			$('.'+self.name_imgIcon).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.trChIconName, e.clientX, e.clientY);
			});
			$('.'+self.name_imgIcon).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$('.'+self.name_imgIcon).click(function(){
				var idxCh = $('.'+self.name_imgIcon).index(this);
				objCombProc.setInspectorChFromTrack(idxCh);
			});

			/* Track Name ----------------------------------------------------------*/
			//Navigation
			$('.'+self.name_spnTag).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.trChIconName, e.clientX, e.clientY);
			});
			$('.'+self.name_spnTag).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$('.'+self.name_spnTag).click(function(){
				var idxCh = $('.'+self.name_spnTag).index(this);
				objCombProc.setInspectorChFromTrack(idxCh);
			});

			/* Mute ----------------------------------------------------------------*/
			//Navigation
			$('.'+self.name_btnMute).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.mute, e.clientX, e.clientY);
			});
			$('.'+self.name_btnMute).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$('.'+self.name_btnMute).click(function(){
				var idxCh = $('.'+self.name_btnMute).index(this);
				var chMode = objCombProc.switchMuteFromITMF(self.actSrc, idxCh);
				self.setBtnColorForMuteToTrack(idxCh, chMode);
			});

			/* Solo ----------------------------------------------------------------*/
			//Navigation
			$('.'+self.name_btnSolo).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.solo, e.clientX, e.clientY);
			});
			$('.'+self.name_btnSolo).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$('.'+self.name_btnSolo).click(function(){
				var idxCh = $('.'+self.name_btnSolo).index(this);
				var chMode = objCombProc.switchSoloFromITMF(self.actSrc, idxCh);
				self.setBtnColorForSoloToTrack(chMode);
			});

			/* Rec Automation ------------------------------------------------------*/
			//Navigation
			$('.'+self.name_btnRecAM).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.amRec, e.clientX, e.clientY);
			});
			$('.'+self.name_btnRecAM).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$('.'+self.name_btnRecAM).click(function(){
				var idxCh = $('.'+self.name_btnRecAM).index(this);
				var chModeAM = objCombProc.switchAmRecFromITMF(self.actSrc, idxCh);
				self.setBtnColorForRecAmToTrack(idxCh, chModeAM);
			});

			/* Play Automation -----------------------------------------------------*/
			//Navigation
			$('.'+self.name_btnPlayAM).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.amPlay, e.clientX, e.clientY);
			});
			$('.'+self.name_btnPlayAM).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$('.'+self.name_btnPlayAM).click(function(){
				var idxCh = $('.'+self.name_btnPlayAM).index(this);
				var chModeAM = objCombProc.switchAmPlayFromITMF(self.actSrc, idxCh);
				self.setBtnColorForPlayAmToTrack(idxCh, chModeAM);
			});

			/* e(effect) -----------------------------------------------------------*/
			//Navigation
			$('.'+self.name_btnEffect).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.effect, e.clientX, e.clientY);
			});
			$('.'+self.name_btnEffect).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$('.'+self.name_btnEffect).click(function(){
				var idxCh = $('.'+self.name_btnEffect).index(this);
				objCombProc.switchEffectFromITMF(self.actSrc, idxCh);
			});
		});
	},
	/*============================================================================
	Set Button color for Mute to Track
	============================================================================*/
	setBtnColorForMuteToTrack: function(idxCh, chMode){
		this.cmnProcToSetBtnColorOfMuteSolo(idxCh, chMode);
	},
	/*============================================================================
	Set Button color for Solo to Track 
	============================================================================*/
	setBtnColorForSoloToTrack: function(chMode){
		for(var i=0, len=chModes.length; i<len; i++){
			this.cmnProcToSetBtnColorOfMuteSolo(i, chModes[i]);
		}
	},
	/*----------------------------------------------------------------------------
	common proc to set button color of Mute / Solo
	----------------------------------------------------------------------------*/
	cmnProcToSetBtnColorOfMuteSolo: function(idxCh, chMode){
		switch(chMode){
			case 'mute':
				$('.'+this.name_btnMute).eq(idxCh).css('background-color', this.btnColors.mute);
				$('.'+this.name_btnSolo).eq(idxCh).css('background-color', this.btnColors.norm);
			break;
			case 'solo':
				$('.'+this.name_btnMute).eq(idxCh).css('background-color', this.btnColors.norm);
				$('.'+this.name_btnSolo).eq(idxCh).css('background-color', this.btnColors.solo);
			break;
			case 'norm':
				$('.'+this.name_btnMute).eq(idxCh).css('background-color', this.btnColors.norm);
				$('.'+this.name_btnSolo).eq(idxCh).css('background-color', this.btnColors.norm);
			break;
		}; 
	},
	/*============================================================================
	Set Button color for Rec AM to Track 
	============================================================================*/
	setBtnColorForRecAmToTrack: function(idxCh, chModeAM){
		this.cmnProcToSetBtnColorOfRecPlayAM(idxCh, chModeAM);
	},
	/*============================================================================
	Set Button color for Play AM to Track 
	============================================================================*/
	setBtnColorForPlayAmToTrack: function(idxCh, chModeAM){
		this.cmnProcToSetBtnColorOfRecPlayAM(idxCh, chModeAM);
	},
	/*----------------------------------------------------------------------------
	common proc to set button color of Mute / Solo
	----------------------------------------------------------------------------*/
	cmnProcToSetBtnColorOfRecPlayAM: function(idxCh, chModeAM){
		switch(chModeAM){
			case 'rec':
				$('.'+this.name_btnRecAM).eq(idxCh).css('background-color', this.btnColors.recAM);
				$('.'+this.name_btnPlayAM).eq(idxCh).css('background-color', this.btnColors.norm);
				break;
			case 'play':
				$('.'+this.name_btnRecAM).eq(idxCh).css('background-color', this.btnColors.norm);
				$('.'+this.name_btnPlayAM).eq(idxCh).css('background-color', this.btnColors.playAM);
				break;
			default:
				$('.'+this.name_btnRecAM).eq(idxCh).css('background-color', this.btnColors.norm);
				$('.'+this.name_btnPlayAM).eq(idxCh).css('background-color', this.btnColors.norm);
			break;
		};
	},
	/*============================================================================
	Set Button color All part Ch For Norm to Track
	============================================================================*/
	setBtnColorAllPartChForNormToTrack: function(){
		$('.'+this.name_btnMute).css('background-color', this.btnColors.norm);
		$('.'+this.name_btnSolo).css('background-color', this.btnColors.norm);
	},


	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++****++++++
	Automation
	+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++****+++++++*/
	/*============================================================================
	AM EVENT: Automation Buttun
	============================================================================*/
	evtAmBtn: function(){
		var self = this;
		for(var i=0; i<self.numTracks; i++){
			//Navigation
			self.e_cvsAmTrCh[i].onmouseover = function(e){
				if(isNavi) objNavi.dispMsg(self.navType.trChAmBtn, e.clientX, e.clientY);
			};
			self.e_cvsAmTrCh[i].onmouseout = function(){
				if(isNavi) objNavi.hideMsg();
			};

			self.e_cvsAmTrCh[i].onclick = function(){
				var idxCh = parseInt( (this.id).replace(/cvsAmTrCh/g, '') );
				if(self.e_trAmCh[idxCh].style.display === 'none'){											//show AM Tr Ch / View
					var idxTypeAM = self.e_slctAmType[idxCh].selectedIndex;								//get current Automation Type
					self.setAmValLblToSpn(idxCh, idxTypeAM);															//Set Automation Value to Span
					self.setSpnBgcBorderOfAmTimeVal(idxCh);																//Set <span> background color and border of AM time and val
					self.dispHideAmTimeValCvs(idxCh);																			//Display or hide <canvas> of AM time and value
					self.drawAmBg(idxCh);																									//Draw AM BackGround
					self.redrawAmData(idxCh);																							//Draw AM Data
					self.e_trAmCh[idxCh].style.display = '';															//Tr Ch
					self.e_trAmView[idxCh].style.display = '';														//Tr View
					self.isDispAmTr[idxCh] = true;																				//true: display Am Track
				}else{																																	//Hide AM Tr Ch / View
					self.e_trAmCh[idxCh].style.display = 'none';													//Tr Ch 
					self.e_trAmView[idxCh].style.display = 'none';												//Tr View
					self.isDispAmTr[idxCh] = false;																				//false: non-display Am Track
				}
				self.setPlayLineHeight();																								//Set Play Line Height
				self.setVerticalScrollPos();																						//Set Vertical Scroll Position
				self.drawAmBtn(idxCh);																									//Draw Automation Button
			};
		}
	},
	/*============================================================================
	AM EVENT: Select Automation Type
	============================================================================*/
	evtSlctAmType: function(){
		var self = this;
		$(function(){
			//Navigation
			$("."+self.name_slctAmType).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.trChAmType, e.clientX, e.clientY);
			});
			$("."+self.name_slctAmType).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//focus out for short cut key 'space' on Mac Firefox 
			$("."+self.name_slctAmType).click('click', function(e){
			 	if(self.isMacFirefox) e.target.blur();	//focus out
			});

			$("."+self.name_slctAmType).change(function(e){
				var idxCh = $("."+self.name_slctAmType).index(this); 
				//Draw Automation Background Color
				self.drawAmBg(idxCh);

				//Draw Automation Data
				var chAM = objCombProc.getAmDat(idxCh, this.selectedIndex);							//get AM data
				self.drawAM(idxCh, chAM.time, chAM.val);

				//Set Automation Value to Span
				self.setAmValLblToSpn(idxCh, this.selectedIndex);

				//Set Automation mode off
				self.removeAmEvtInTrView(idxCh);																				//Remove current AM event in Tr View
				self.currAmMode[idxCh] = self.bgcModeAM.modeOff;
				self.setAmBtnColor(idxCh);
				self.setSpnBgcBorderOfAmTimeVal(idxCh);
				
//				e.target.blur();	//focus out
			});
		});
	},
	/*============================================================================
	Set Automation Value Label to Span
	============================================================================*/
	setAmValLblToSpn: function(idxCh, idxTypeAM){
		var self = this;
		$(function(){
			//hidden all val span of a automation track ch
			$(".ch"+String(idxCh)+self.name_spnAmValLbl).css('visibility', 'hidden');
			//get fontSize of span
			var fontSize = parseInt($("#ch"+String(idxCh)+self.name_spnAmValLbl+"0").css('font-size'));

			//set Aumation Val to span
			var len = self.infoAM[idxTypeAM].val.length;
			var tdHeight = $("."+self.name_tdAmCh).eq(idxCh).height();
			var delY = tdHeight / len;
			for(var i=0; i<len; i++){
				if(len === 2 && i===len-1){
					var cssContent = {'top':String(tdHeight-fontSize*1.5)+'px', 'visibility':'visible'};
				}else{
					var cssContent = {'top':String(delY*i)+'px', 'visibility':'visible'};
				}
				$(".ch"+String(idxCh)+self.name_spnAmValLbl).eq(i)
					.css(cssContent)
					.text(self.infoAM[idxTypeAM].txt[i]);
			}
		});
	},
	/*============================================================================
	AM EVENT: Zoom Up / Down at a Automation Track ch / view 
	============================================================================*/
	evtZmUpDwnAmTrChView: function(){
		var self = this;
		$(function(){
			/* Zoom Up -------------------------------------------------------------*/
			//Navigation
			$("."+self.name_btnAmZmUp).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.trChAmEnlarge, e.clientX, e.clientY);
			});
			$("."+self.name_btnAmZmUp).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$("."+self.name_btnAmZmUp).click(function(){
				var idxCh = $("."+self.name_btnAmZmUp).index(this); 

				//change td height of Automation track ch
				var tdHeight = $("."+self.name_tdAmCh).eq(idxCh).height();
				tdHeight = tdHeight + self.deltaTdHeight;
				if(tdHeight > self.maxTdHeight) tdHeight = self.maxTdHeight;
				$("."+self.name_tdAmCh).eq(idxCh).height(tdHeight);

				//Zoom Up / Down Common Proc
				self.cmnProcZmUpDwn(idxCh, tdHeight);
			});

			/* Zoom Down -----------------------------------------------------------*/
			//Navigation
			$("."+self.name_btnAmZmDwn).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.trChAmReduce, e.clientX, e.clientY);
			});
			$("."+self.name_btnAmZmDwn).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$("."+self.name_btnAmZmDwn).click(function(){
				var idxCh = $("."+self.name_btnAmZmDwn).index(this); 

				//change td height of Automation track ch
				var tdHeight = $("."+self.name_tdAmCh).eq(idxCh).height();
				tdHeight = tdHeight - self.deltaTdHeight;
				if(tdHeight < self.minTdHeight) tdHeight = self.minTdHeight;
				$("."+self.name_tdAmCh).eq(idxCh).height(tdHeight);

				//Zoom Up / Down Common Proc
				self.cmnProcZmUpDwn(idxCh, tdHeight);
			});
		});
	},
	/*----------------------------------------------------------------------------
	Zoom Up / Down Common Proc
	----------------------------------------------------------------------------*/
	cmnProcZmUpDwn: function(idxCh, tdCvsHeight){
		//get current Automation Type
		var idxTypeAM = this.e_slctAmType[idxCh].selectedIndex;

		//Set Automation Value to Span
		this.setAmValLblToSpn(idxCh, idxTypeAM);

		//set td /canvas height of Automation track view
		this.setAmTrViewHeight(idxCh, tdCvsHeight);

		//Draw Automation BackGround
		this.drawAmBg(idxCh);

		//Draw Automation Data
		this.redrawAmData(idxCh);

		//Set Play Line Height
		this.setPlayLineHeight();

		//Set Vertical Scroll Pos
		this.setVerticalScrollPos();
	},
	/*============================================================================
	AM EVENT: change Automation Mode 
	============================================================================*/
	evtChgAmMode: function(){
		var self = this;
		$(function(){
			/*Delete button --------------------------------------------------------*/
			//Navigation
			$("."+self.name_btnAmDel).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.trChAmDel, e.clientX, e.clientY);
			});
			$("."+self.name_btnAmDel).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$("."+self.name_btnAmDel).click(function(){
				var idxCh = $("."+self.name_btnAmDel).index(this);
				self.removeAmEvtInTrView(idxCh);
				if(self.currAmMode[idxCh] ===  self.bgcModeAM.modeDel) self.currAmMode[idxCh] = self.bgcModeAM.modeOff;
				else self.currAmMode[idxCh] = self.bgcModeAM.modeDel;
				self.cmnProcAmBtnEvt(idxCh);
			});
			/* Add button ----------------------------------------------------------*/
			//Navigation
			$("."+self.name_btnAmAdd).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.trChAmAdd, e.clientX, e.clientY);
			});
			$("."+self.name_btnAmAdd).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$("."+self.name_btnAmAdd).click(function(){
				var idxCh = $("."+self.name_btnAmAdd).index(this);
				self.removeAmEvtInTrView(idxCh);
				if(self.currAmMode[idxCh] ===  self.bgcModeAM.modeAdd) self.currAmMode[idxCh] = self.bgcModeAM.modeOff;
				else self.currAmMode[idxCh] = self.bgcModeAM.modeAdd;
				self.cmnProcAmBtnEvt(idxCh);
			});
			/* Move button ---------------------------------------------------------*/
			//Navigation
			$("."+self.name_btnAmMove).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.trChAmMove, e.clientX, e.clientY);
			});
			$("."+self.name_btnAmMove).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$("."+self.name_btnAmMove).click(function(){
				var idxCh = $("."+self.name_btnAmMove).index(this);
				self.removeAmEvtInTrView(idxCh);
				if(self.currAmMode[idxCh] ===  self.bgcModeAM.modeMove) self.currAmMode[idxCh] = self.bgcModeAM.modeOff;
				else self.currAmMode[idxCh] = self.bgcModeAM.modeMove;
				self.cmnProcAmBtnEvt(idxCh);
			});
			/* Edit button ---------------------------------------------------------*/
			//Navigation
			$("."+self.name_btnAmEdit).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.trChAmEdit, e.clientX, e.clientY);
			});
			$("."+self.name_btnAmEdit).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$("."+self.name_btnAmEdit).click(function(){
				var idxCh = $("."+self.name_btnAmEdit).index(this);
				self.removeAmEvtInTrView(idxCh);
				if(self.currAmMode[idxCh] ===  self.bgcModeAM.modeEdit) self.currAmMode[idxCh] = self.bgcModeAM.modeOff;
				else self.currAmMode[idxCh] = self.bgcModeAM.modeEdit;
				self.cmnProcAmBtnEvt(idxCh);
			});
		});
	},
	/*----------------------------------------------------------------------------
	Common Process Automation Button Event
	----------------------------------------------------------------------------*/
	cmnProcAmBtnEvt: function(idxCh){
		this.setAmBtnColor(idxCh);								//set AM button color
		this.setSpnBgcBorderOfAmTimeVal(idxCh);		//set <span> of color, text, etc for AM value and time
		this.dispHideAmTimeValCvs(idxCh);					//hide <canvas> for AM time /val Drag & Drop event
		this.addAmEvtInTrView(idxCh);							//Add AM event in Track View
		this.redrawAmData(idxCh);									//Draw AM data
	},
	/*============================================================================
	Set Automation Button color and Text
	============================================================================*/
	setAmBtnColor: function(idxCh){
		switch(this.currAmMode[idxCh]){
			case this.bgcModeAM.modeDel:
				this.e_btnAmDel[idxCh].style.backgroundColor = this.bgcModeAM.bgcDel;
				this.e_btnAmAdd[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmMove[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmEdit[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				break;
			case this.bgcModeAM.modeAdd:
				this.e_btnAmDel[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmAdd[idxCh].style.backgroundColor = this.bgcModeAM.bgcAdd;
				this.e_btnAmMove[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmEdit[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				break;
			case this.bgcModeAM.modeMove:
				this.e_btnAmDel[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmAdd[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmMove[idxCh].style.backgroundColor = this.bgcModeAM.bgcMove;
				this.e_btnAmEdit[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				break;
			case this.bgcModeAM.modeEdit:
				this.e_btnAmDel[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmAdd[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmMove[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmEdit[idxCh].style.backgroundColor = this.bgcModeAM.bgcEdit;
				break;
			case this.bgcModeAM.modeOff:
			default:
				this.e_btnAmDel[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmAdd[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmMove[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				this.e_btnAmEdit[idxCh].style.backgroundColor = this.bgcModeAM.bgcOff;
				break;
		};
	},
	/*============================================================================
	Set <span> background color and border of Automation Time and Value  
	============================================================================*/
	setSpnBgcBorderOfAmTimeVal: function(idxCh){
		switch(this.currAmMode[idxCh]){
			case this.bgcModeAM.modeDel:
			case this.bgcModeAM.modeAdd:
			case this.bgcModeAM.modeMove:
			case this.bgcModeAM.modeOff:
				this.e_spnAmMin[idxCh].style.backgroundColor = 'transparent';
				this.e_spnAmSec[idxCh].style.backgroundColor = 'transparent';
				this.e_spnAmMsec[idxCh].style.backgroundColor = 'transparent';
				this.e_spnAmVal[idxCh].style.backgroundColor = 'transparent';
				break;
			case this.bgcModeAM.modeEdit:
				this.e_spnAmMin[idxCh].style.backgroundColor = 'white';
				this.e_spnAmSec[idxCh].style.backgroundColor = 'white';
				this.e_spnAmMsec[idxCh].style.backgroundColor = 'white';
				this.e_spnAmVal[idxCh].style.backgroundColor = 'white';
				break;
		};
		//set span text
		this.e_spnAmMin[idxCh].innerHTML = '--';
		this.e_spnAmSec[idxCh].innerHTML = '--';
		this.e_spnAmMsec[idxCh].innerHTML = '---';
		this.e_spnAmVal[idxCh].innerHTML = '-----';
		//set span text color
		this.e_spnAmMin[idxCh].style.color = 'black';
		this.e_spnAmSec[idxCh].style.color = 'black';
		this.e_spnAmMsec[idxCh].style.color = 'black';
		this.e_spnAmVal[idxCh].style.color = 'black';
		//allien / pading
		this.e_spnAmVal[idxCh].style.textAlign = 'center';
		this.e_spnAmVal[idxCh].style.paddingRight = '0px';
	},
	/*========================================================================
	display or hide canvas of Automation time and value  
	========================================================================*/
	dispHideAmTimeValCvs: function(idxCh){
		if(this.currAmMode[idxCh] === this.bgcModeAM.modeEdit && this.bufChAM[idxCh].startIdx !== null){
			this.e_cvsAmMin[idxCh].style.display = 'block';
			this.e_cvsAmSec[idxCh].style.display = 'block';
			this.e_cvsAmMsec[idxCh].style.display = 'block';
			this.e_cvsAmVal[idxCh].style.display = 'block';
		}else{
			this.e_cvsAmMin[idxCh].style.display = 'none';
			this.e_cvsAmSec[idxCh].style.display = 'none';
			this.e_cvsAmMsec[idxCh].style.display = 'none';
			this.e_cvsAmVal[idxCh].style.display = 'none';
		}
	},
	/*============================================================================
	Set Automation Time and Value to <span>   
	============================================================================*/
	setAmTimeValToSpn: function(idxCh, idxTypeAM, recTime, val, txtColor){
		//Time to <span>
		var min, sec, msec, undSec;
		min = String( Math.floor(recTime / 60) );				//min(String)
		undSec = recTime % 60;													//under sec(double) 
		sec = Math.floor(undSec);												//sec(double)
		msec = Math.ceil((undSec - sec) * 1000);				//msec(double)
		if(msec === 1000){	//measure for the calculation error of Math.ceil  
			msec = 0;
			sec = sec + 1;
		}
		if(min.length === 1) min = '0' + min;						//'0' -> '00'
		sec = String(sec);
		if(sec.length === 1) sec = '0' + sec;						//'0' -> '00'
		msec = String(msec);
		if(msec.length === 1) msec = '00' + msec;				//'0'  -> '000'
		else if(msec.length === 2) msec = '0' + msec;		//'00' -> '000'
		this.e_spnAmMin[idxCh].innerHTML = min;
		this.e_spnAmSec[idxCh].innerHTML = sec;
		this.e_spnAmMsec[idxCh].innerHTML = msec;
		this.e_spnAmMin[idxCh].style.color = txtColor;
		this.e_spnAmSec[idxCh].style.color = txtColor;
		this.e_spnAmMsec[idxCh].style.color = txtColor;

		//val / txt to <span>
		switch(this.infoAM[idxTypeAM].type){
			case 'range':
				this.e_spnAmVal[idxCh].innerHTML = String(val.toFixed(this.infoAM[idxTypeAM].digit));
				this.e_spnAmVal[idxCh].style.textAlign = 'right';
				this.e_spnAmVal[idxCh].style.paddingRight = '2px';
				break;
			case 'select':
				this.e_spnAmVal[idxCh].style.textAlign = 'center';
				this.e_spnAmVal[idxCh].style.paddingRight = '0px';
				var numVal = this.infoAM[idxTypeAM].val.length;
				for(var i=0; i<numVal; i++){
					if(val === this.infoAM[idxTypeAM].val[i]){
						this.e_spnAmVal[idxCh].innerHTML = this.infoAM[idxTypeAM].txt[i];
						break;
					}
				}
				break;
		};
		this.e_spnAmVal[idxCh].style.color = txtColor;
	},
	/*============================================================================
	AM EVENT: change AM Min Value with Drag & Drop
	============================================================================*/
	evtChgAmDatDnD: function(){
		var fcsClrs = objCombProc.getFocusColors();
		this.colorFocusOn = fcsClrs.on;
		this.colorFocusOff = fcsClrs.off;

		for(var i=0; i<this.numTracks; i++){
			/* EVENT: regist AM time event with Drag & Drop ------------------------*/
			this.regAmTimeEvtDnD(i, this.e_cvsAmMin[i], this.e_spnAmMin[i], 'min', this.strAmTimeValTop);
			this.regAmTimeEvtDnD(i, this.e_cvsAmSec[i], this.e_spnAmSec[i], 'sec', this.strAmTimeValTop);
			this.regAmTimeEvtDnD(i, this.e_cvsAmMsec[i], this.e_spnAmMsec[i], 'msec', this.strAmTimeValTop);
			/* EVENT: regist AM value event with Drag & Drop -----------------------*/
			this.regAmValEvtDnD(i, this.e_cvsAmVal[i], this.e_spnAmVal[i], this.strAmTimeValTop);
		}
	},
	/*----------------------------------------------------------------------------
	EVENT: regist Automation time event with Drag & Drop
	----------------------------------------------------------------------------*/
	regAmTimeEvtDnD: function(idxCh, cvs, spn, typeTime, strStartTop){
		var self = this;
		//EVENT:mouse over / out
		 cvs.onmouseover = function(e){
			if(self.currAmMode[idxCh] === self.bgcModeAM.modeEdit && self.bufChAM[idxCh].startIdx !== null){
				spn.style.backgroundColor = self.colorFocusOn;
				if(isNavi) objNavi.dispMsg(self.navType.trChAmTime, e.clientX, e.clientY); //
			}
		};
		cvs.onmouseout = function(){
			if(self.currAmMode[idxCh] === self.bgcModeAM.modeEdit && self.bufChAM[idxCh].startIdx !== null){
				spn.style.backgroundColor = self.colorFocusOff;
				if(isNavi) objNavi.hideMsg();
			}
		};
		//an automation time control with jQuery plug-in 'Draggabliiy'
		var dndEvt = new Draggabilly(cvs, {axis:'y'});	//moving direction vertical
		//EVENT:<canvas> mouse click -----------------------------------------------
		dndEvt.on('pointerDown', function(){
			if(self.currAmMode[idxCh] === self.bgcModeAM.modeEdit && self.bufChAM[idxCh].startIdx !== null){
				self.bufAmDatInDnD = self.getAmTimeFromSpn(idxCh);											//get AM time from span
				self.bufDndVal = null;
				//console.log(self.bufAmDatInDnD);
			}
		});
		//EVENT:<canvas> draggin ---------------------------------------------------
		dndEvt.on('dragMove', function(event, pointer, moveVector){
			if(self.currAmMode[idxCh] === self.bgcModeAM.modeEdit && self.bufChAM[idxCh].startIdx !== null){
				spn.style.backgroundColor = self.colorFocusOn;													//background color for focus on
				//update AM recTime
				var updateTime = self.chgAmTimeInDnD(typeTime, self.bufAmDatInDnD, -moveVector.y);
				if(self.bufDndVal === updateTime) return;																//check same time
				else self.bufDndVal = updateTime;
				self.setAmTimeToSpn(idxCh, updateTime);
				//current AM value
				var currVal = self.getAmValFromSpn(idxCh);
				//delete and insert Automation buffe data
				self.delInsAmBufDat(idxCh, updateTime, currVal);
				//Draw Automation data
				self.drawAM(idxCh, self.bufChAM[idxCh].time, self.bufChAM[idxCh].val, self.bufChAM[idxCh].currIdx, self.bgcModeAM.bgcEdit);
			}
		});
		//EVENT:<canvas> drag end --------------------------------------------------
		dndEvt.on('dragEnd', function(event){
			if(self.currAmMode[idxCh] === self.bgcModeAM.modeEdit && self.bufChAM[idxCh].startIdx !== null){
				// this.element.style.top = strStartTop;																		//set start top position
				cvs.style.top = strStartTop;																		//set start top position
				//console.log(cvs.style.top);
				spn.style.backgroundColor = self.colorFocusOff;													//background color for focus off
				self.bufAmValInDnD = null;																							//clear buf for DnD
				self.bufDndVal = null;
				//Delete and Add AM data
				var idxTypeAM = self.e_slctAmType[idxCh].selectedIndex;
				var currIdx = self.bufChAM[idxCh].currIdx;
				//console.log('startIdx:' + self.bufChAM[idxCh].startIdx + ' currIdx:' + currIdx);
				var chAM = objCombProc.delAndAddAmDatFromTrack(idxCh, idxTypeAM, self.bufChAM[idxCh].startIdx, self.bufChAM[idxCh].time[currIdx], self.bufChAM[idxCh].val[currIdx]);
				//Update of bufChAM
				self.bufChAM[idxCh].startIdx = chAM.datIdx;
				self.bufChAM[idxCh].currIdx = chAM.datIdx;
				self.bufChAM[idxCh].time = chAM.time.slice();
				self.bufChAM[idxCh].val = chAM.val.slice();
				//Draw Automation data
				self.drawAM(idxCh, chAM.time, chAM.val, self.bufChAM[idxCh].currIdx, self.bgcModeAM.bgcEdit);
				}
		});
		self.dndEvts.push(dndEvt);
	},
	/*----------------------------------------------------------------------------
	EVENT: regist Automation value event with Drag & Drop
	----------------------------------------------------------------------------*/
	regAmValEvtDnD: function(idxCh, cvs, spn, strStartTop){
		var self = this;
		//EVENT:mouse over / out
		 cvs.onmouseover = function(e){
			if(self.currAmMode[idxCh] === self.bgcModeAM.modeEdit && self.bufChAM[idxCh].startIdx !== null){
				spn.style.backgroundColor = self.colorFocusOn;
				if(isNavi) objNavi.dispMsg(self.navType.trChAmVal, e.clientX, e.clientY);
			}
		};
		cvs.onmouseout = function(){
			if(self.currAmMode[idxCh] === self.bgcModeAM.modeEdit && self.bufChAM[idxCh].startIdx !== null){
				spn.style.backgroundColor = self.colorFocusOff;
				if(isNavi) objNavi.hideMsg();
			}
		};
		//an automation valie control with jQuery plug-in 'Draggabliiy'
		var dndEvt = new Draggabilly(cvs, {axis:'y'});	//moving direction vertical
		//EVENT:<canvas> mouse click -----------------------------------------------
		dndEvt.on('pointerDown', function(){
			if(self.currAmMode[idxCh] === self.bgcModeAM.modeEdit && self.bufChAM[idxCh].startIdx !== null){
				self.bufAmDatInDnD = self.getAmValFromSpn(idxCh);												//get AM time from span
				self.bufDndVal = null;
				//console.log(self.bufAmDatInDnD);
			}
		});
		//EVENT:<canvas> draggin ---------------------------------------------------
		dndEvt.on('dragMove', function(event, pointer, moveVector){
			if(self.currAmMode[idxCh] === self.bgcModeAM.modeEdit && self.bufChAM[idxCh].startIdx !== null){
				spn.style.backgroundColor = self.colorFocusOn;													//background color for focus on
				//update AM value 
				var updateVal = self.chgSetAmValInDnD(idxCh, self.bufAmDatInDnD, -moveVector.y);
				if(self.bufDndVal === updateVal) return;																//check same time
				else self.bufDndVal = updateVal;
				//current AM time
				var currTime = self.getAmTimeFromSpn(idxCh);
				//delete and insert Automation buffe data
				self.delInsAmBufDat(idxCh, currTime, updateVal);
				//Draw Automation data
				self.drawAM(idxCh, self.bufChAM[idxCh].time, self.bufChAM[idxCh].val, self.bufChAM[idxCh].currIdx, self.bgcModeAM.bgcEdit);
			}
		});
		//EVENT:<canvas> drag end --------------------------------------------------
		dndEvt.on('dragEnd', function(event){
			if(self.currAmMode[idxCh] === self.bgcModeAM.modeEdit && self.bufChAM[idxCh].startIdx !== null){
				this.element.style.top = strStartTop;																		//set start top position
				spn.style.backgroundColor = self.colorFocusOff;													//background color for focus off
				self.bufAmValInDnD = null;																							//clear buf for DnD
				self.bufDndVal = null;
				//Delete and Add AM data
				var idxTypeAM = self.e_slctAmType[idxCh].selectedIndex;
				var currIdx = self.bufChAM[idxCh].currIdx;
				var chAM = objCombProc.delAndAddAmDatFromTrack(idxCh, idxTypeAM, self.bufChAM[idxCh].startIdx, self.bufChAM[idxCh].time[currIdx], self.bufChAM[idxCh].val[currIdx]);
				//Draw Automation data
				self.drawAM(idxCh, chAM.time, chAM.val, self.bufChAM[idxCh].currIdx, self.bgcModeAM.bgcEdit);
				//Update startIdx of bufChAM
				self.bufChAM[idxCh].startIdx = currIdx;
			}
		});
		self.dndEvts.push(dndEvt);
	},
	/*----------------------------------------------------------------------------
	Get Automation Time from <span>
	----------------------------------------------------------------------------*/
	getAmTimeFromSpn: function(idxCh){
		var min = parseInt(this.e_spnAmMin[idxCh].innerHTML);
		var sec = parseInt(this.e_spnAmSec[idxCh].innerHTML);
		var msec = parseFloat(this.e_spnAmMsec[idxCh].innerHTML);
		return min * 60 + sec + msec / 1000;
	},
	/*----------------------------------------------------------------------------
	Chagne Automation Time In drag and drop 
	----------------------------------------------------------------------------*/
	chgAmTimeInDnD: function(typeTime, baseTime, delta){
		switch(typeTime){
			case 'min':
				var val = baseTime + delta * 60;
				break;
			case 'sec':
				var val = baseTime + delta;
				break;
			case 'msec':
				var val = baseTime + delta / 1000;
				break;
		};
		//check max / min time 
		if(val > this.prjMaxTime) val = this.prjMaxTime;
		else if(val < 0) val = 0;

		return val;
	},
	/*----------------------------------------------------------------------------
	Set Automation time to span
	----------------------------------------------------------------------------*/
	setAmTimeToSpn: function(idxCh, chgTime){
		var min = String(Math.floor(chgTime / 60));
		var undSec = chgTime % 60;
		var sec = String(Math.floor(undSec));
		var msec = String(Math.ceil((undSec - sec) * 1000));
		if(msec === 1000){ //measure for Math.ceil calculation error
			sec = sec + 1;
			msec = 0;
		}
		if(min.length === 1) this.e_spnAmMin[idxCh].innerHTML = '0' + min;
		else this.e_spnAmMin[idxCh].innerHTML = min;
		if(sec.length === 1) this.e_spnAmSec[idxCh].innerHTML = '0' + sec;
		else this.e_spnAmSec[idxCh].innerHTML = sec;
		if(msec.length === 1) this.e_spnAmMsec[idxCh].innerHTML = '00' + msec;
		else if(msec.length === 2) this.e_spnAmMsec[idxCh].innerHTML = '0' + msec;
		else this.e_spnAmMsec[idxCh].innerHTML = msec;
	},
	/*----------------------------------------------------------------------------
	Get Automation value from span
	----------------------------------------------------------------------------*/
	getAmValFromSpn: function(idxCh){
		var idxTypeAM = this.e_slctAmType[idxCh].selectedIndex;
		switch(this.infoAM[idxTypeAM].type){
			case 'range':
				return parseFloat(this.e_spnAmVal[idxCh].innerHTML);
				break;
			case 'select':
				txt = this.e_spnAmVal[idxCh].innerHTML;
				var len = this.infoAM[idxTypeAM].val.length;
				for(var i=0; i<len; i++){
					if(this.infoAM[idxTypeAM].txt[i] === txt){
						return this.infoAM[idxTypeAM].val[i];
					}
				}
				break;
		};
	},
	/*----------------------------------------------------------------------------
	Chagne and Set Automation Value In drag and drop 
	----------------------------------------------------------------------------*/
	chgSetAmValInDnD: function(idxCh, baseVal, delta){
		var idxTypeAM = this.e_slctAmType[idxCh].selectedIndex;
		switch(this.infoAM[idxTypeAM].type){
			case 'range':
				var val = baseVal + delta * this.infoAM[idxTypeAM].step;
				if(val > this.infoAM[idxTypeAM].val[0]) val = this.infoAM[idxTypeAM].val[0];			//max
				else if(val < this.infoAM[idxTypeAM].val[1]) val = this.infoAM[idxTypeAM].val[1];	//min
				this.e_spnAmVal[idxCh].innerHTML = String(val.toFixed(this.infoAM[idxTypeAM].digit));
				break;
			case 'select':
				var len = this.infoAM[idxTypeAM].val.length;
				for(var i=0; i<len; i++){
					if(baseVal === this.infoAM[idxTypeAM].val[i]) break;									//seek baseVal index
				}
				var idxVal = i - delta;	//array order is descending!
				if(idxVal < 0) idxVal = 0;
				else if(idxVal > len-1) idxVal = len-1;
				var val = this.infoAM[idxTypeAM].val[idxVal];
				this.e_spnAmVal[idxCh].innerHTML = String(this.infoAM[idxTypeAM].txt[idxVal]);
				break;
		}
		return val;
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Cross Browser
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Set isBlur to Track
	============================================================================*/
	setIsBlurToTrack: function(){
		this.isMacFirefox = true;
	},


	/*****************************************************************************
	Auto Scroll & Zoom
	*****************************************************************************/
	initAutoScrollAndZoom: function(){
		var self = this;
		self.e_btnAutoScrollX = document.getElementById('btnAutoScrollX');
		self.e_btnMagX = document.getElementById('btnMagX');
		self.e_btnRedX = document.getElementById('btnRedX');

		/*==========================================================================
		Auto Scroll for holizontal
		==========================================================================*/
		//Navigation
		self.e_btnAutoScrollX.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.trAutoScroll, e.clientX, e.clientY);
		};
		self.e_btnAutoScrollX.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};

		self.e_btnAutoScrollX.onclick = function(){
			self.isAutoScrollX = !self.isAutoScrollX;
			if(self.isAutoScrollX) self.e_btnAutoScrollX.style.backgroundColor = 'orange';
			else self.e_btnAutoScrollX.style.backgroundColor =  'white';
		};

		/*==========================================================================
		Horizontal zoom up
		==========================================================================*/
		//Navigation
		self.e_btnMagX.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.trEnlargeTime, e.clientX, e.clientY);
		};
		self.e_btnMagX.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};

		self.e_btnMagX.onclick = function(){
			if(self.currPxPerSec >= 96){
				return;
			}else{
				self.currPxPerSec = self.currPxPerSec * 2;	//3 -> 9 -> 12 -> 24 -> 48 -> 96
				self.cmnHorizontalZmUpDwnProc();
			}
		};

		/*==========================================================================
		Horizontal zoom down
		==========================================================================*/
		//Navigation
		self.e_btnRedX.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.trReduceTime, e.clientX, e.clientY);
		};
		self.e_btnRedX.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};

		self.e_btnRedX.onclick = function(){
			if(self.currPxPerSec <= 3){
				return;
			}else{
				self.currPxPerSec = self.currPxPerSec / 2;	//96 -> 48 -> 24 -> 12 -> 6 -> 3
				self.cmnHorizontalZmUpDwnProc();
			}
		};
	},
	/*----------------------------------------------------------------------------
	common proc of horizontal zoom up / down
	----------------------------------------------------------------------------*/
	cmnHorizontalZmUpDwnProc: function(){
			this.chgTimeRulerTrViwCvsWidth();
			this.setHorizontalScrollPos();
			this.drawTimeGrid();
			this.locateRepeatMarkerAndRegion();
			if(typeof this.duration !== 'undefined'){
				for(var i=0, len=this.numTracks; i<len; i++){
					if(this.duration[i] !== void 0) this.drawWave(i);	//wave form
				}
			}
			this.drawAllAM();
			this.e_cvsPlayLine.style.left = this.currPxPerSec * objCombProc.getPlayTime() + self.mrkSide/2 + 'px';
	},

	/*****************************************************************************
	All Part Ch Mute / Solo
	*****************************************************************************/
	initAllPartChMuteSolo: function(){
		var self = this;
		/* Mute ------------------------------------------------------------------*/
		this.e_btnAllPartChMuteState = document.getElementById('btnAllPartChMuteState');
		this.e_btnAllPartChMuteState.style.backgroundColor = this.btnColors.norm;

		//Navigation
		self.e_btnAllPartChMuteState.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.trAllDisableMute, e.clientX, e.clientY);
		};
		self.e_btnAllPartChMuteState.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};

		this.e_btnAllPartChMuteState.onclick = function(){
			if(self.isAllPartChMuteState){
				objCombProc.setAllPartChInNrmModeFromTrack();
				self.isAllPartChMuteState = false;
				self.setBtnColorAllPartChMuteState();
			}
		};

		/* Solo ------------------------------------------------------------------*/
		this.e_btnAllPartChSoloState = document.getElementById('btnAllPartChSoloState');
		this.e_btnAllPartChSoloState.style.backgroundColor = this.btnColors.norm;

		//Navigation
		self.e_btnAllPartChSoloState.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.trAllDisableSolo, e.clientX, e.clientY);
		};
		self.e_btnAllPartChSoloState.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};

		this.e_btnAllPartChSoloState.onclick = function(){
			if(self.isAllPartChSoloState){
				objCombProc.setAllPartChInNrmModeFromTrack();
				self.isAllPartChSoloState = false;
				self.setBtnColorAllPartChSoloState();
			}
		};
	},
	/*----------------------------------------------------------------------------
	Set Button color of All Part Ch's Mute state
	----------------------------------------------------------------------------*/
	setBtnColorAllPartChMuteState: function(){
		if(this.isAllPartChMuteState){
			this.e_btnAllPartChMuteState.style.backgroundColor = this.btnColors.mute;
		}else{
			this.e_btnAllPartChMuteState.style.backgroundColor = this.btnColors.norm;
		}
	},
	/*----------------------------------------------------------------------------
	Set Button color of All Part Ch's Solo state
	----------------------------------------------------------------------------*/
	setBtnColorAllPartChSoloState: function(){
		if(this.isAllPartChSoloState){
			this.e_btnAllPartChSoloState.style.backgroundColor = this.btnColors.solo;
		}else{
			this.e_btnAllPartChSoloState.style.backgroundColor = this.btnColors.norm;
		}
	},
	/*============================================================================
	Set Button color Of All Part Ch's Mute/Solo State
	============================================================================*/
	setBtnColorAllPartChMuteSoloState: function(isMute, isSolo){
		if(isSolo) this.isAllPartChMuteState = false;
		else       this.isAllPartChMuteState = isMute;
		this.isAllPartChSoloState = isSolo;
		this.setBtnColorAllPartChMuteState();
		this.setBtnColorAllPartChSoloState();
	},


	/*****************************************************************************
	Track View
	*****************************************************************************/
	initTrackView: function(){
		/* make Track View Elements ----------------------------------------------*/
		this.makeTrViewElements();

		/* Navigation for Wave Form ----------------------------------------------*/
		this.naviForWavFrm();

		/* EVENT: canvas Horizontal Scroll ---------------------------------------*/
		this.makeCvsHorizontalScrollEvt();

		/* EVENT: Horzontal Scroll with Mouse Wheel ------------------------------*/
		this.evtMouseWheelHorizontalScroll();

		/* EVENT: canvas Vertical Scroll -----------------------------------------*/
		this.makeCvsVerticalScrollEvt();

		/* EVENT: Vertical Scroll with Mouse Wheel -------------------------------*/
		this.evtMouseWheelVerticalScroll();

		/* EVENT: change Play Line Position --------------------------------------*/
		this.evtChgPlayLinePos();

		/* Draw time grid on time ruler ------------------------------------------*/
		this.drawTimeGrid();

		/*Navigation Automation Mode ---------------------------------------------*/
		this.navAmMode();

		/* EVENT: register Automation mode ---------------------------------------*/
		this.regChgAmMode();

		/* set Vertical Scroll Pos (for initialize of each div's scrollTop) ------*/
		this.setHorizontalScrollPos();
		this.setVerticalScrollPos();
	},
	/*============================================================================
	make Track View Elements
	============================================================================*/
	makeTrViewElements: function(){
		var self = this;
		var trTrCh;
		var trID;
		var tdID;
			for(var i=0; i<self.numTracks; i++){
			/* wave form -----------------------------------------------------------*/
			trID = self.name_trTrView + String(i);
			tdID = self.name_tdTrView + String(i);
			$('<tr></tr>')
				.attr("class", self.name_trTrView)
				.attr("id", trID)
				.appendTo("#tabTrView");
			$('<td></td>')
				// .attr("class", self.name_tdTrCh)
				.attr("class", self.name_tdTrView)
				.attr("id", tdID)
				.attr("height", "60px")
				.css({'position':'relative'})
				.appendTo("#" + trID);
			//Wave form
			$('<canvas></canvas>')
				.attr("class", self.name_cvsTrView)
				.attr("id", self.name_cvsTrView + String(i))
				// .attr("width", "20000px")
				.attr("width", String(self.currPxPerSec*self.prjMaxTime + self.scrolEndMrgn)+"px")
				.attr("height", "60px")
				.css({'position':'absolute', 'top':'0px', 'left':'0px'})
				//.css({'background-color':'white'})
				.appendTo("#" + tdID);
			/* Automation ----------------------------------------------------------*/
			trID = self.name_trAmView + String(i);
			tdID = self.name_tdAmView + String(i);
			$('<tr></tr>')
				.attr("class", self.name_trAmView)
				.attr("id", trID)
				.css('display','none')
				.appendTo("#tabTrView");
			$('<td></td>')
				.attr("class", self.name_tdAmView)
				.attr("id", tdID)
				.attr("height", "60px")
				.css({'position':'relative'})
				.appendTo("#" + trID);
			//Automation - background
			$('<canvas></canvas>')
				.attr("class", self.name_cvsTrAmBg)
				.attr("id", self.name_cvsTrAmBg + String(i))
				// .attr("width", "20000px")
				.attr("width", String(self.currPxPerSec*self.prjMaxTime + self.scrolEndMrgn)+"px")
				.attr("height", "60px")
				.css({'position':'absolute', 'top':'0px', 'left':'0px', 'z-index':'0'})
				.appendTo("#" + tdID);
			//Automation - data
			$('<canvas></canvas>')
				.attr("class", self.name_cvsTrAm)
				.attr("id", self.name_cvsTrAm + String(i))
				// .attr("width", "20000px")
				.attr("width", String(self.currPxPerSec*self.prjMaxTime + self.scrolEndMrgn)+"px")
				.attr("height", "60px")
				.css({'position':'absolute', 'top':'0px', 'left':'0px', 'z-index':'1'})
				.appendTo("#" + tdID);
		}

		/* Set each element to variant -------------------------------------------*/
		self.e_divTrView = document.getElementById('divTrView');
		self.e_divTrView_positionX = self.e_divTrView.getBoundingClientRect().left + window.pageXOffset;
		this.e_tabTrView = document.getElementById('tabTrView');
		self.e_trAmView = document.getElementsByClassName(self.name_trAmView);
		self.e_cvsWavForm = document.getElementsByClassName(self.name_cvsTrView);		//wave form
		self.e_cvsAmBgForm = document.getElementsByClassName(self.name_cvsTrAmBg);	//automation - background
		self.e_cvsAmForm = document.getElementsByClassName(self.name_cvsTrAm);			//automation - data
	},
	/*============================================================================
	Navigation for Wave Form
	============================================================================*/
	naviForWavFrm: function(){
		var self = this;
		for(var i=0; i<self.numTracks; i++){
			this.e_cvsWavForm[i].onmouseover = function(e){
				if(isNavi) objNavi.dispMsg(self.navType.trVwWaveForm, e.clientX, e.clientY);
			};
			this.e_cvsWavForm[i].onmouseout = function(){
				if(isNavi) objNavi.hideMsg();
			};
		}
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Horizontal / Vertical Scroll for Track View and Track Ch
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	EVENT: canvas Horizontal Scroll
	============================================================================*/
	makeCvsHorizontalScrollEvt: function(){
		var self = this;
		self.e_cvsTrScrollX = document.getElementById('cvsTrScrollX');
		self.e_cvsTrScrollX.style.left = "0px";	//init pos
		self.e_divTrScrollX = document.getElementById('divTrScrollX');
		self.rngScrollX = self.e_divTrScrollX.clientWidth - self.e_cvsTrScrollX.width;

		//Scroll X with jQuery plug-in 'Draggabilly'
		var dndEvt = new Draggabilly(self.e_cvsTrScrollX, {containment: self.e_divTrScrollX, axis: 'x'});
		//Event: mouse drag --------------------------------------------------------
		dndEvt.on('dragMove', function(event, pointer, moveVector){
			var x = this.dragPoint.x + this.relativeStartPosition.x;
			//console.log(x);
			var ratio = x / self.rngScrollX;
			var amtScrollX = ratio * (self.e_tabTrView.scrollWidth - self.e_divTrView.clientWidth);
			// console.log(amtScrollX);

			self.e_divTrView.scrollLeft = amtScrollX;
			self.e_divTimeRuler.scrollLeft = amtScrollX;
		});
		self.dndScrlEvt.push(dndEvt);	//regist <canvas>'s drag and drop events
	},
	/*============================================================================
	Set Horizontal Scroll Pos
	============================================================================*/
	setHorizontalScrollPos: function(){
		var currX = parseInt(this.e_cvsTrScrollX.style.left);
		var ratio = currX / this.rngScrollX;
		var amtScrollX = ratio * (this.e_tabTrView.scrollWidth - this.e_divTrView.clientWidth);
		this.e_divTrView.scrollLeft = amtScrollX;
		this.e_divTimeRuler.scrollLeft = amtScrollX;
	},
	/*============================================================================
	EVENT: Horzontal Scroll with Mouse Wheel
	============================================================================*/
	evtMouseWheelHorizontalScroll: function(){
		var self = this;
		//For Safari, Chrome
		self.e_divTrScrollX.addEventListener("mousewheel", function(e){
			var newX = parseInt(self.e_cvsTrScrollX.style.left) - e.wheelDelta / 40;
			if(newX < 0) newX = 0;
			if(newX > self.rngScrollX) newX = self.rngScrollX;
			var ratio = newX / self.rngScrollX;
			var amtScrollX = ratio * (self.e_tabTrView.scrollWidth - self.e_divTrView.clientWidth);
			self.e_divTrView.scrollLeft = amtScrollX;
			self.e_divTimeRuler.scrollLeft = amtScrollX;
			self.e_cvsTrScrollX.style.left = String(newX)+'px';

			//Window scroll desable
			e.preventDefault();
		}, false);

		//for FireFox
		self.e_divTrScrollX.addEventListener("DOMMouseScroll", function(e){
			var newX = parseInt(self.e_cvsTrScrollX.style.left) + e.detail;
			if(newX < 0) newX = 0;
			if(newX > self.rngScrollX) newX = self.rngScrollX;
			var ratio = newX / self.rngScrollX;
			var amtScrollX = ratio * (self.e_tabTrView.scrollWidth - self.e_divTrView.clientWidth);
			self.e_divTrView.scrollLeft = amtScrollX;
			self.e_divTimeRuler.scrollLeft = amtScrollX;
			self.e_cvsTrScrollX.style.left = String(newX)+'px';

			//Window scroll desable
			e.preventDefault();
		}, false);
	},
	/*============================================================================
	EVENT: canvas Vertical Scroll
	============================================================================*/
	makeCvsVerticalScrollEvt: function(){
		var self = this;
		self.e_cvsTrScrollY = document.getElementById('cvsTrScrollY');
		self.e_cvsTrScrollY.style.top = "0px";	//init pos
		self.e_divTrScrollY = document.getElementById('divTrScrollY');
		self.rngScrollY = self.e_divTrScrollY.clientHeight - self.e_cvsTrScrollY.height;

		//Scroll Y with jQuery plug-in 'Draggabilly'
		var dndEvt = new Draggabilly(self.e_cvsTrScrollY, {containment: self.e_divTrScrollY, axis: 'y'});
		//Event: mouse drag --------------------------------------------------------
		dndEvt.on('dragMove', function(event, pointer, moveVector){
			var y = this.dragPoint.y + this.relativeStartPosition.y;
			// console.log(y);
			var ratio = y / self.rngScrollY;
			var amtScrollY = ratio * (self.e_tabTrView.clientHeight - self.e_divTrView.clientHeight);
			//console.log(amtScrollY);

			self.e_divTrView.scrollTop = amtScrollY;
			self.e_divTrCh.scrollTop = amtScrollY;

		});
		self.dndScrlEvt.push(dndEvt);	//regist <canvas>'s drag and drop events
	},
	/*============================================================================
	Set Vertical Scroll Pos
	============================================================================*/
	setVerticalScrollPos: function(){
		var currY = parseInt(this.e_cvsTrScrollY.style.top);
		var ratio = currY / this.rngScrollY;
		var amtScrollY = ratio * (this.e_tabTrView.clientHeight - this.e_divTrView.clientHeight);
		this.e_divTrView.scrollTop = amtScrollY;
		this.e_divTrCh.scrollTop = amtScrollY;
	},
	/*============================================================================
	EVENT: Vertical Scroll with mouse wheel
	============================================================================*/
	evtMouseWheelVerticalScroll: function(){
		var self = this;
		//For Safari, Chrome
		self.e_divTrScrollY.addEventListener("mousewheel", function(e){
			var newY = parseInt(self.e_cvsTrScrollY.style.top) - e.wheelDelta / 40;
			if(newY < 0) newY = 0;
			if(newY > self.rngScrollY) newY = self.rngScrollY;
			var ratio = newY / self.rngScrollY;
			var amtScrollY = ratio * (self.e_tabTrView.clientHeight - self.e_divTrView.clientHeight);
			self.e_divTrView.scrollTop = amtScrollY;
			self.e_divTrCh.scrollTop = amtScrollY;
			self.e_cvsTrScrollY.style.top = String(newY)+'px';

			//Window scroll desable
			e.preventDefault();
		}, false);

		//for FireFox
		self.e_divTrScrollY.addEventListener("DOMMouseScroll", function(e){
			var newY = parseInt(self.e_cvsTrScrollY.style.top) + e.detail;
			if(newY < 0) newY = 0;
			if(newY > self.rngScrollY) newY = self.rngScrollY;
			var ratio = newY / self.rngScrollY;
			var amtScrollY = ratio * (self.e_tabTrView.clientHeight - self.e_divTrView.clientHeight);
			self.e_divTrView.scrollTop = amtScrollY;
			self.e_divTrCh.scrollTop = amtScrollY;
			self.e_cvsTrScrollY.style.top = String(newY)+'px';

			//Window scroll desable
			e.preventDefault();
		}, false);
	},
	/*============================================================================
	Event: change Play Line postion on Wave Form
	============================================================================*/
	evtChgPlayLinePos: function(){
		var self = this;
		for(i=0; i<self.numTracks; i++){
			self.e_cvsWavForm[i].onclick = function(e){
				if(e.metaKey || e.ctrlKey){																							//Repeat region sets the width of wave form
					var trIdx = parseInt( (this.id).replace(/cvsTrView/g, '') );
					self.timeRepeatMarkerL = self.startPos[trIdx];
					self.timeRepeatMarkerR = self.timeRepeatMarkerL + self.duration[trIdx];
					self.locateRepeatMarkerAndRegion();
					objCombProc.setRepeatRegionFromTrack(self.timeRepeatMarkerL, self.timeRepeatMarkerR);
				}else{
					// self.setPlayLinePosAndPlayTime(e.clientX + self.e_divTrView.scrollLeft - self.e_divTrView_positionX);
					var assignedPos = e.clientX + self.e_divTrView.scrollLeft - self.e_divTrView_positionX;
					if(assignedPos < self.mrkSide/2) assignedPos = self.mrkSide/2;
					self.setPlayLinePosAndPlayTime(assignedPos);

				}
			}
		};
	},
	/*============================================================================
	change canvas width of Time Ruler and Track View 
	============================================================================*/
	chgTimeRulerTrViwCvsWidth: function(){
		//Time Ruler
		this.e_cvsTimeRuler.width = this.currPxPerSec*this.prjMaxTime + this.scrolEndMrgn;
		for(var i=0; i<this.numTracks; i++){
			//Wave Form
			this.e_cvsWavForm[i].width = this.currPxPerSec*this.prjMaxTime + this.scrolEndMrgn;
			//Autmation background
			this.e_cvsAmBgForm[i].width = this.currPxPerSec*this.prjMaxTime + this.scrolEndMrgn;
			//Autmation Form
			this.e_cvsAmForm[i].width = this.currPxPerSec*this.prjMaxTime + this.scrolEndMrgn;
		}
	},
	/*============================================================================
	Draw time grid for time ruler and wave form
	============================================================================*/
	drawTimeGrid: function(){
		/* ruler -----------------------------------------------------------------*/
		var cvsRuler = this.e_cvsTimeRuler;
		var cvsRulerCtx = cvsRuler.getContext('2d');
		cvsRulerCtx.clearRect(0, 0, cvsRuler.width, cvsRuler.height);	//clear rect
		cvsRulerCtx.fillStyle = 'lightgray';
		var xPitch = this.currPxPerSec;																//px per 1sec
		var x;
		var min = 0;
		var gridTime;
		for(var i=0, len=cvsRuler.width/this.currPxPerSec; i<len; i++){
			// x = xPitch * i;
			x = xPitch * i + this.mrkSide/2;	//mrkSide is AM marker.
			if(i % 10 === 0){
				cvsRulerCtx.fillRect(x, 0, 0.5, cvsRuler.height);

				if(i === this.prjMaxTime) break;	//skip time value at project maximum time 

				//time value - under construction
				gridTime = i % 60;
				if(gridTime === 0){
					if(i !== 0) ++min;	//count up 'min'
					gridTime = '0' + String(min) + ':' + '0' + gridTime;	//second time is just '0'.
				}else{
					gridTime = '0' + String(min) + ':' + gridTime;				//second time is 10, 20, ... 50
				}
				cvsRulerCtx.fillText(gridTime, x+3, cvsRuler.height-5, 30);
			}else if(i % 2 === 0){
				cvsRulerCtx.fillRect(x, 0, 0.5, cvsRuler.height/3);
			}
		}
		/* wave form -------------------------------------------------------------*/
		var canvas;
		var canvasContext;
		for(var i=0, len=this.e_cvsWavForm.length; i<len; i++ ){
			canvas = this.e_cvsWavForm[i];
			canvasContext = canvas.getContext('2d');
			canvasContext.clearRect(0, 0, canvas.width, canvas.height);		//clear rect

			canvasContext.strokeStyle = 'lightgray';
			//canvasContext.strokeRect(0, 0, canvas.width, canvas.height);	//draw outline

			canvasContext.fillStyle = 'lightgray';
			//upper side line
			canvasContext.fillRect(this.mrkSide/2, 0, canvas.width-this.mrkSide/2, 0.5);
			//lower side line
			canvasContext.fillRect(this.mrkSide/2, canvas.height-1, canvas.width-this.mrkSide/2, 0.5);

			// canvasContext.fillStyle = 'lightgray';												//draw grid at each 10sec
			// canvasContext.beginPath();
			var xRate = this.currPxPerSec;
			for (var j = 0, num=canvas.width/this.currPxPerSec; j<num; j++) {
				//x = xRate * j;
				x = xRate * j + this.mrkSide/2;	//mrkSide is AM marker.
				// if (j === 0) {
				// 	canvasContext.moveTo(x, canvas.height);
				// } else {
					if (j % 10 === 0) {
						canvasContext.fillRect(x, 0, 0.5, canvas.height);
					}
				// }
			};
			// canvasContext.stroke();
		}
	}, //EOF drawTimeGrid
	/*============================================================================
	Drawing wave form
	============================================================================*/
	drawWave: function(index){
		var self = this;
		var canvas = this.e_cvsWavForm[index];
		var canvasContext = canvas.getContext('2d');
		canvasContext.globalAlpha = 0.6;
		canvasContext.fillStyle = self.trackColors[index];
		// canvasContext.shadowOffsetX = 1;
		// canvasContext.shadowOffsetY = 1;
		// canvasContext.shadowColor = 'lightgray';
		// canvasContext.shadowBlur = 1;

		// var offsetX = this.currPxPerSec * this.startPos[index];
		var offsetX = this.currPxPerSec * this.startPos[index] + this.mrkSide/2;
		var widthDrawArea = this.currPxPerSec * this.duration[index];

		canvasContext.fillRect(offsetX, 0, widthDrawArea, canvas.height);

		canvasContext.strokeStyle = 'black';
		var n10msec = Math.floor(10 * Math.pow(10, -3) * context.sampleRate); //draw point at each 10msec
		var datWav = this.wavData[index];

		canvasContext.beginPath();
		for (var i=0, len=datWav.length; i<len; i++) {
			if ((i % n10msec) === 0) { 		//select data at each 10msec.
				var x = (i / len) * widthDrawArea;
				var y = ((1 - datWav[i]) / 2) * canvas.height;
				if (i === 0) {
					canvasContext.moveTo(x+offsetX , y);
				} else {
					canvasContext.lineTo(x+offsetX, y);
				}
			}
		};
		canvasContext.stroke();
	},//EOF dispWave
	/*============================================================================
	set sounds info
	============================================================================*/
	setSoundParamToTrack: function(index, duration, wavData, startPos){
		this.duration[index] = duration;
		this.wavData[index] = wavData;
		this.startPos[index] = startPos;
		this.drawWave(index);
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation in Track View
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Draw Automation background
	============================================================================*/
	drawAmBg: function(idxCh){
		var cvs = this.e_cvsAmBgForm[idxCh];
		var cvsCtx = cvs.getContext('2d');
		cvsCtx.clearRect(0, 0, cvs.width, cvs.height);		//clear rect
		cvsCtx.globalAlpha = 0.25;

		var idxTypeAM = this.e_slctAmType[idxCh].selectedIndex;
		if(this.infoAM[idxTypeAM].type === 'range'){

		}else if(this.infoAM[idxTypeAM].type === 'select'){
			for(var i=0, len=this.infoAM[idxTypeAM].bgColor.length; i<len; i++){
				//console.log(this.infoAM[idxTypeAM].bgColor[i]);
				cvsCtx.fillStyle = this.infoAM[idxTypeAM].bgColor[i];
				// cvsCtx.fillRect(0, i/len*cvs.height, cvs.width, (i+1)/len*cvs.height);
				cvsCtx.fillRect(this.mrkSide/2, i/len*cvs.height, cvs.width-this.mrkSide/2, (i+1)/len*cvs.height);
			}
		}
	},
	/*============================================================================
	Navigation of Automation Mode
	============================================================================*/
	navAmMode: function(){
		var self = this;
		for(var i=0; i<self.numTracks; i++){
			//mousemove --------------------------------------------------------------
			self.e_cvsAmForm[i].addEventListener('mousemove', function(e){
				if(isNavi){
					//index of Part Ch.
					var idxCh = parseInt( (this.id).replace(/cvsTrAm/g, '') );
					switch(self.currAmMode[idxCh]){
						case self.bgcModeAM.modeDel:
							objNavi.dispMsg(self.navType.trVwAmDel, e.clientX, e.clientY);
							break;
						case self.bgcModeAM.modeAdd:
							objNavi.dispMsg(self.navType.trVwAmAdd, e.clientX, e.clientY);
							break;
						case self.bgcModeAM.modeMove:
							objNavi.dispMsg(self.navType.trVwAmMove, e.clientX, e.clientY);
							break;
						case self.bgcModeAM.modeEdit:
							objNavi.dispMsg(self.navType.trVwAmEdit, e.clientX, e.clientY);
							break;
						case self.bgcModeAM.modeOff:
							objNavi.dispMsg(self.navType.trVwAmOff, e.clientX, e.clientY);
						default:
							break;
					};
				}
			}, false);

			//mouseout ---------------------------------------------------------------
			self.e_cvsAmForm[i].addEventListener('mouseout', function(e){
				if(isNavi) objNavi.hideMsg();
			}, false);
		}
	},


	/*============================================================================
	Register Change Automation Mode
	============================================================================*/
	regChgAmMode: function(){
		var self = this;
		for(var i=0; i<self.numTracks; i++){
			self.e_cvsAmForm[i].addEventListener('click' ,function(e){
				//index of Part Ch.
				var idxCh = parseInt( (this.id).replace(/cvsTrAm/g, '') );

				//change Automation Mode with alt, ctrl/meta, shift
				if(e.altKey && e.shiftKey && (e.metaKey || e.ctrlKey)){
					//console.log('off');
					self.removeAmEvtInTrView(idxCh);
					self.currAmMode[idxCh] = self.bgcModeAM.modeOff;
				}else if(e.altKey && (e.metaKey || e.ctrlKey)){
					self.removeAmEvtInTrView(idxCh);
					self.currAmMode[idxCh] = self.bgcModeAM.modeEdit;
				}else if(e.altKey){
					self.removeAmEvtInTrView(idxCh);
				 	self.currAmMode[idxCh] = self.bgcModeAM.modeDel;
				}else if(e.metaKey || e.ctrlKey){
					self.removeAmEvtInTrView(idxCh);
					self.currAmMode[idxCh] = self.bgcModeAM.modeAdd;
				}else if(e.shiftKey){
					self.removeAmEvtInTrView(idxCh);
					self.currAmMode[idxCh] = self.bgcModeAM.modeMove;
				}
				//change button and redraw
				if(e.shiftKey || e.altKey || e.shiftKey || e.metaKey || e.ctrlKey){
					self.setAmBtnColor(idxCh);
					self.redrawAmData(idxCh);
					self.addAmEvtInTrView(idxCh);
				}
			}, false);
		}
	},
	/*============================================================================
	Remove current Automation Event
	============================================================================*/
	removeAmEvtInTrView: function(idxCh){
		var self = this;
		switch(self.currAmMode[idxCh]){
			// Delete Mode -----------------------------------------------------------
			case self.bgcModeAM.modeDel:
				self.e_cvsAmForm[idxCh].removeEventListener('mouseout', self.mouseoutInDelMode, false);
				self.e_cvsAmForm[idxCh].removeEventListener('mousemove', self.mousemoveInDelMode, false);
				self.e_cvsAmForm[idxCh].removeEventListener('click', self.mouseclickInDelMode, false);
				break;
			// Add Mode --------------------------------------------------------------
			case self.bgcModeAM.modeAdd:
				self.e_cvsAmForm[idxCh].removeEventListener('mouseout', self.mouseoutInAddMode, false);
				self.e_cvsAmForm[idxCh].removeEventListener('mousemove', self.mousemoveInAddMode, false);
				self.e_cvsAmForm[idxCh].removeEventListener('click', self.mouseclickInAddMode, false);
				break;
			// Move Mode -------------------------------------------------------------
			case self.bgcModeAM.modeMove:
				self.e_cvsAmForm[idxCh].removeEventListener('mouseout', self.mouseoutInMoveMode, false);
				self.e_cvsAmForm[idxCh].removeEventListener('mousemove', self.mousemoveInMoveMode, false);
				self.e_cvsAmForm[idxCh].removeEventListener('mousedown', self.mousedownInMoveMode, false);
				self.e_cvsAmForm[idxCh].removeEventListener('click', self.mouseclickInMoveMode, false);
				break;
			// Edit Mode -------------------------------------------------------------
			case self.bgcModeAM.modeEdit:
				self.e_cvsAmForm[idxCh].removeEventListener('mouseout', self.mouseoutInMoveMode, false);
				self.e_cvsAmForm[idxCh].removeEventListener('mousemove', self.mousemoveInEditMode, false);
				self.e_cvsAmForm[idxCh].removeEventListener('click', self.mouseclickInEditMode, false);
				break;
		};
		//clear buf Am data
		self.clrBufChAM(idxCh);
	},
	/*============================================================================
	Add Event for Automation in Track View
	============================================================================*/
	addAmEvtInTrView: function(idxCh){
		var self = this;
		switch(self.currAmMode[idxCh]){
			// Delete Mode -----------------------------------------------------------
			case self.bgcModeAM.modeDel:
				self.e_cvsAmForm[idxCh].addEventListener('mouseout', self.mouseoutInDelMode, false);
				self.e_cvsAmForm[idxCh].addEventListener('mousemove', self.mousemoveInDelMode, false);
				self.e_cvsAmForm[idxCh].addEventListener('click', self.mouseclickInDelMode, false);
				break;
			// Add Mode --------------------------------------------------------------
			case self.bgcModeAM.modeAdd:
				self.e_cvsAmForm[idxCh].addEventListener('mouseout', self.mouseoutInAddMode, false);
				self.e_cvsAmForm[idxCh].addEventListener('mousemove', self.mousemoveInAddMode, false);
				self.e_cvsAmForm[idxCh].addEventListener('click', self.mouseclickInAddMode, false);
				break;
			// Move Mode -------------------------------------------------------------
			case self.bgcModeAM.modeMove:
				self.e_cvsAmForm[idxCh].addEventListener('mouseout', self.mouseoutInMoveMode, false);
				self.e_cvsAmForm[idxCh].addEventListener('mousemove', self.mousemoveInMoveMode, false);
				self.e_cvsAmForm[idxCh].addEventListener('mousedown', self.mousedownInMoveMode, false);
				self.e_cvsAmForm[idxCh].addEventListener('click', self.mouseclickInMoveMode, false);
				break;
			// Edit Mode -------------------------------------------------------------
			case self.bgcModeAM.modeEdit:
				self.e_cvsAmForm[idxCh].addEventListener('mouseout', self.mouseoutInEditMode, false);
				self.e_cvsAmForm[idxCh].addEventListener('mousemove', self.mousemoveInEditMode, false);
				self.e_cvsAmForm[idxCh].addEventListener('click', self.mouseclickInEditMode, false);
		};
	},
	/*----------------------------------------------------------------------------
	Automation Delete event: mouse out
	----------------------------------------------------------------------------*/
	mouseoutInDelMode: function(e){
		var self = objTrack;
		var idxCh = parseInt( (this.id).replace(/cvsTrAm/g, '') );
		//Init Automation Time and Value to <span>   
		self.setSpnBgcBorderOfAmTimeVal(idxCh);
		//Redraw Automation Data in Add mode
		self.redrawAmData(idxCh);
	},
	/*----------------------------------------------------------------------------
	Automation Delete event: mouse move
	----------------------------------------------------------------------------*/
	mousemoveInDelMode: function(e){
		var self = objTrack;
		var p = self.getAmEvtValInTrView(e);				//get AM event values in Tr View
		//this mouse positon means under 0 sec.  
		if(p.isUnd0sec || p.isOvr3min){
			self.setSpnBgcBorderOfAmTimeVal(p.idxCh);	//Init Automation Time and Value to <span>   
			self.redrawAmData(p.idxCh);
			return;
		}
		//Seek a target data from time(x-axis)
		var r = objCombProc.seekTgtAmDatFromTrack(p.idxCh, p.idxTypeAM, p.recTime, self.mrkSeekRng);
		//set Automation time and val to span
		if(r === null || r.tgtIdx === null){
			self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, p.recTime, p.val, self.bgcModeAM.bgcDef);
		}else{
			self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, r.chAM.time[r.tgtIdx], r.chAM.val[r.tgtIdx], self.bgcModeAM.txcDel);
		}
		//Draw Automation Data
		if(r === null) return;
		self.drawAM(p.idxCh, r.chAM.time, r.chAM.val, r.tgtIdx, self.bgcModeAM.bgcDel);
	},
	/*----------------------------------------------------------------------------
	Automation Delete event: click
	----------------------------------------------------------------------------*/
	mouseclickInDelMode: function(e){
		var self = objTrack;
		var p = self.getAmEvtValInTrView(e);	//get AM event values in Tr View
		//this mouse positon means under 0 sec.  
		if(p.isUnd0sec || p.isOvr3min){
			self.setSpnBgcBorderOfAmTimeVal(p.idxCh);	//Init Automation Time and Value to <span>   
			return;
		}
		//Delete Automation Data
		var chAM = objCombProc.delAmDatFromTrack(p.idxCh, p.idxTypeAM, p.recTime, self.mrkSeekRng);
		//Draw Automation data
		self.drawAM(p.idxCh, chAM.time, chAM.val, null, '');
		//set Automation time and val to span
		self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, p.recTime, p.val, self.bgcModeAM.bgcDef);
	},
	/*----------------------------------------------------------------------------
	Automation Add event: mouse out
	----------------------------------------------------------------------------*/
	mouseoutInAddMode: function(e){
		var self = objTrack;
		var idxCh = parseInt( (this.id).replace(/cvsTrAm/g, '') );
		//Init Automation Time and Value to <span>   
		self.setSpnBgcBorderOfAmTimeVal(idxCh);
		//Redraw Automation Data in Add mode
		self.redrawAmData(idxCh);
	},
	/*----------------------------------------------------------------------------
	Automation Add event: mouse move
	----------------------------------------------------------------------------*/
	mousemoveInAddMode: function(e){
		var self = objTrack;
		var p = self.getAmEvtValInTrView(e);	//get AM event values in Tr View
		//Get Automation data
		var chAM = objCombProc.getAmDat(p.idxCh,p.idxTypeAM);
		//Draw Automation Data
		self.drawAM(p.idxCh, chAM.time, chAM.val, null, '');
		//this mouse positon means under 0 sec.  
		if(p.isUnd0sec || p.isOvr3min){
			self.setSpnBgcBorderOfAmTimeVal(p.idxCh);	//Init Automation Time and Value to <span>   
			return;
		}
		//draw a mark 
		var cvsCtx = this.getContext('2d');
		cvsCtx.fillStyle = self.bgcModeAM.bgcAdd;
		cvsCtx.fillRect(p.x-self.mrkSide/2, p.y-self.mrkSide/2, self.mrkSide, self.mrkSide);
		//set Automation time and val to span
		self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, p.recTime, p.val, self.bgcModeAM.txcAdd);
	},
	/*----------------------------------------------------------------------------
	Automation Add event: click
	----------------------------------------------------------------------------*/
	mouseclickInAddMode: function(e){
		var self = objTrack;
		var p = self.getAmEvtValInTrView(e);		//get AM event values in Tr View
		if(p.isUnd0sec || p.isOvr3min) return;	//this mouse positon means under 0 sec. 
		//set Automation Data
		var chAM = objCombProc.setAmDataFromTrack(p.idxCh, p.idxTypeAM, p.recTime, p.val);
		//Draw Automation data
		self.drawAM(p.idxCh, chAM.time, chAM.val, null, '');
		//set Automation time and val to span
		self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, p.recTime, p.val, self.bgcModeAM.txcAdd);
	},
	/*----------------------------------------------------------------------------
	Automation Move event: mouse out
	----------------------------------------------------------------------------*/
	mouseoutInMoveMode: function(e){
		var self = objTrack;
		var idxCh = parseInt( (this.id).replace(/cvsTrAm/g, '') );
		//Init Automation Time and Value to <span>   
		self.setSpnBgcBorderOfAmTimeVal(idxCh);
	},
	/*----------------------------------------------------------------------------
	Automation Move event: mouse move
	----------------------------------------------------------------------------*/
	mousemoveInMoveMode: function(e){
		var self = objTrack;
		var p = self.getAmEvtValInTrView(e);	//get AM event values in Tr View

		// if(e.buttons === 1){																											//Drag & Drop
			//if(self.bufChAM[p.idxCh].startIdx === null) return;
		if(self.bufChAM[p.idxCh].startIdx !== null && self.bufChAM[p.idxCh].isClick === true){	//Drag & Drop

			//this mouse positon means under 0 sec. 
			if(p.isUnd0sec || p.isOvr3min){
				self.setSpnBgcBorderOfAmTimeVal(p.idxCh);
				return;
			}
			//delete and insert Automation buffe data
			self.delInsAmBufDat(p.idxCh, p.recTime, p.val);
			//set Automation time and val to span
			self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, p.recTime, p.val, self.bgcModeAM.txcMove);
			//Draw Automation data
			self.drawAM(p.idxCh, self.bufChAM[p.idxCh].time, self.bufChAM[p.idxCh].val, self.bufChAM[p.idxCh].currIdx, self.bgcModeAM.bgcMove);
		}else{																																			//normal operation
			//this mouse positon means under 0 sec. 
			if(p.isUnd0sec || p.isOvr3min){
				self.setSpnBgcBorderOfAmTimeVal(p.idxCh);
				self.redrawAmData(p.idxCh);
				return;
			}
			//set Automation time and val to span
			var r = objCombProc.seekTgtAmDatFromTrack(p.idxCh, p.idxTypeAM, p.recTime, self.mrkSeekRng);
			if(r === null || r.tgtIdx === null){
				self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, p.recTime, p.val, self.bgcModeAM.bgcDef);
			}else{
				self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, r.chAM.time[r.tgtIdx], r.chAM.val[r.tgtIdx], self.bgcModeAM.txcMove);
			}
			//Draw Automation Data
			if(r === null) return;																										//no automation data 
			self.drawAM(p.idxCh, r.chAM.time, r.chAM.val, r.tgtIdx, self.bgcModeAM.bgcMove);
		}
	},
	/*----------------------------------------------------------------------------
	Automation Move event: mouse down
	----------------------------------------------------------------------------*/
	mousedownInMoveMode: function(e){
		var self = objTrack;
		var p = self.getAmEvtValInTrView(e);	//get AM event values in Tr View
		//this mouse positon means under 0 sec. 
		if(p.isUnd0sec || p.isOvr3min){
			self.setSpnBgcBorderOfAmTimeVal(p.idxCh);
			return;
		}
		var r = objCombProc.seekTgtAmDatFromTrack(p.idxCh, p.idxTypeAM, p.recTime, self.mrkSeekRng);
		if(r === null) return;																											//no automation data 
		if(r.tgtIdx !== null){
			self.bufChAM[p.idxCh].startIdx = r.tgtIdx;					//for click event
			self.bufChAM[p.idxCh].currIdx = r.tgtIdx;						//for mousemove event
			self.bufChAM[p.idxCh].time = r.chAM.time.slice();		//for mousemove event drawing
			self.bufChAM[p.idxCh].val = r.chAM.val.slice();			//for mousemove event drawing
			self.bufChAM[p.idxCh].isClick = true;
		}
	},
	/*----------------------------------------------------------------------------
	Automation Move event: click
	----------------------------------------------------------------------------*/
	mouseclickInMoveMode: function(e){
		var self = objTrack;
		var p = self.getAmEvtValInTrView(e);	//get AM event values in Tr View
		if(self.bufChAM[p.idxCh].currIdx === null) return;
		//this mouse positon means under 0 sec. 
		if(p.isUnd0sec || p.isOvr3min){
			self.setSpnBgcBorderOfAmTimeVal(p.idxCh);
			return;
		}
		//delete assigned automation data and add moved automation data
		var chAM = objCombProc.delAndAddAmDatFromTrack(p.idxCh, p.idxTypeAM, self.bufChAM[p.idxCh].startIdx, p.recTime, p.val);
		//Draw Automation data
		self.drawAM(p.idxCh, chAM.time, chAM.val, null, '');
		//clear buf Am data
		self.clrBufChAM(p.idxCh);
		//set Automation time and val to span
		self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, p.recTime, p.val, self.bgcModeAM.bgcDef);
	},
	/*----------------------------------------------------------------------------
	Automation Edit event: mouse out
	----------------------------------------------------------------------------*/
	mouseoutInEditMode: function(e){
		var self = objTrack;
		var idxCh = parseInt( (this.id).replace(/cvsTrAm/g, '') );
		if(self.bufChAM[idxCh].startIdx === null){
			//Init Automation Time and Value to <span>   
			self.setSpnBgcBorderOfAmTimeVal(idxCh);
			//Redraw Automation Data in Add mode
			self.redrawAmData(idxCh);
		}
	},
	/*----------------------------------------------------------------------------
	Automation Edit event: mouse move
	----------------------------------------------------------------------------*/
	mousemoveInEditMode: function(e){
		var self = objTrack;
		var p = self.getAmEvtValInTrView(e);	//get AM event values in Tr View
		if(self.bufChAM[p.idxCh].startIdx === null){																//normal opration
			//this mouse positon means under 0 sec. 
			if(p.isUnd0sec || p.isOvr3min){
				self.setSpnBgcBorderOfAmTimeVal(p.idxCh);
				self.redrawAmData(p.idxCh);
				return;
			}
			//set Automation time and val to span
			var r = objCombProc.seekTgtAmDatFromTrack(p.idxCh, p.idxTypeAM, p.recTime, self.mrkSeekRng);
			if(r === null || r.tgtIdx === null){
				self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, p.recTime, p.val, self.bgcModeAM.bgcDef);
			}else{
				self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, r.chAM.time[r.tgtIdx], r.chAM.val[r.tgtIdx], self.bgcModeAM.bgcEdit);
			}
			//Draw Automation Data
			if(r === null) return;	//no automation data 
			self.drawAM(p.idxCh, r.chAM.time, r.chAM.val, r.tgtIdx, self.bgcModeAM.bgcEdit);
		}else{																																				//editing operation
			//Draw Automation Data
			self.drawAM(p.idxCh, self.bufChAM[p.idxCh].time, self.bufChAM[p.idxCh].val, self.bufChAM[p.idxCh].currIdx, self.bgcModeAM.bgcEdit);
		}
	},
	/*----------------------------------------------------------------------------
	Automation Edit event: mouse click
	----------------------------------------------------------------------------*/
	mouseclickInEditMode: function(e){
		var self = objTrack;
		var p = self.getAmEvtValInTrView(e);	//get AM event values in Tr View
		//this mouse positon means under 0 sec. 
		if(p.isUnd0sec || p.isOvr3min){
			self.setSpnBgcBorderOfAmTimeVal(p.idxCh);
			return;
		}
		if(self.bufChAM[p.idxCh].startIdx === null){
			var r = objCombProc.seekTgtAmDatFromTrack(p.idxCh, p.idxTypeAM, p.recTime, self.mrkSeekRng);
			if(r === null) return;																										//no automation data 
			if(r.tgtIdx !== null){
				//start editing operation
				self.bufChAM[p.idxCh].startIdx = r.tgtIdx;					//for Move mode end event
				self.bufChAM[p.idxCh].currIdx = r.tgtIdx;						//for drawing Automation px dat in Move mode
				self.bufChAM[p.idxCh].time = r.chAM.time.slice();		//for mousemove event drawing
				self.bufChAM[p.idxCh].val = r.chAM.val.slice();			//for mousemove event drawing
				//display or hide canvas of Automation time and value  
				self.dispHideAmTimeValCvs(p.idxCh);
			}
		}else{
			//clear buf Am data
			self.clrBufChAM(p.idxCh);
			//redraw AM data
			self.redrawAmData(p.idxCh);
			//set Automation time and val to span
			self.setAmTimeValToSpn(p.idxCh, p.idxTypeAM, p.recTime, p.val, self.bgcModeAM.bgcDef);
			//display or hide canvas of Automation time and value  
			self.dispHideAmTimeValCvs(p.idxCh);
		}
	},
	/*----------------------------------------------------------------------------
	Get Automation Event Values In Track View
	----------------------------------------------------------------------------*/
	getAmEvtValInTrView: function(e){
		var idxCh = parseInt( (e.target.id).replace(/cvsTrAm/g, '') );
		var rect = e.target.getBoundingClientRect();
		var x = e.clientX - rect.left;
		var y = e.clientY - rect.top;
		if(x-this.mrkSide/2 < 0) var isUnd0sec = true;
		else var isUnd0sec = false;
		if(x > e.target.width - this.mrkSide/2) var isOvr3min = true;								//'1' is fine adjustment
		else var isOvr3min = false;

		var idxTypeAM = this.e_slctAmType[idxCh].selectedIndex;
		var val = this.getAmDatFromCvs(e.target.height, y, idxTypeAM);
		return {
			idxCh: idxCh,																															//index of Part Ch.
			x: x,																																			//mouse position x
			y: y,																																			//mouse position y
			isUnd0sec: isUnd0sec,
			isOvr3min: isOvr3min,
			// recTime: x / this.currPxPerSec,																				//recTime from mouse position
			recTime: (x-this.mrkSide/2) / this.currPxPerSec,													//recTime from mouse position
			val: val,																																	//AM value 
			idxTypeAM: idxTypeAM,																											//AM Type from select
		};
	},
	/*----------------------------------------------------------------------------
	Get Automation data(value & text) from canvas
	----------------------------------------------------------------------------*/
	getAmDatFromCvs: function(height, posY, idxTypeAM){
		switch(this.infoAM[idxTypeAM].type){
			case 'range':
				//adjust mouse position and height for drawing marker top or bottom side 
				var adjY = posY - this.mrkSide/2;
				if(adjY < 0) var adjY = 0;
				else if(adjY > height-this.mrkSide) var adjY = height - this.mrkSide;
				var adjH = height - this.mrkSide;
				var min = this.infoAM[idxTypeAM].val[1];
				var max = this.infoAM[idxTypeAM].val[0];
				// var val = (height-posY) / height * (max-min) + min;
				var val = (adjH-adjY) / adjH * (max-min) + min;
				if(val > max) val = max;
				if(val < min) val = min;
				break;
			case 'select':
				var numVal = this.infoAM[idxTypeAM].val.length;
				for(var i=1; i<=numVal; i++){
					if(posY < (height / numVal * i)){
						var val = this.infoAM[idxTypeAM].val[i-1];
						break;
					}
				}
				break;
		};
		return val;
	},
	/*----------------------------------------------------------------------------
	Delete & Insert Automation Buffer data
	----------------------------------------------------------------------------*/
	delInsAmBufDat(idxCh, recTime, val){
		//Delete Automation buffer data
		this.bufChAM[idxCh].time.splice(this.bufChAM[idxCh].currIdx, 1);
		this.bufChAM[idxCh].val.splice(this.bufChAM[idxCh].currIdx, 1);

		//Insert Automation buffer data
		var len = this.bufChAM[idxCh].time.length;
		for(var i=0; i<len; i++){
			if(recTime < this.bufChAM[idxCh].time[i]){
				if(i === 0){																														//insert as first index
					this.bufChAM[idxCh].time.unshift(recTime);
					this.bufChAM[idxCh].val.unshift(val);
					this.bufChAM[idxCh].currIdx = i;
					// console.log(this.bufChAM[idxCh]);
					return;
				}else{																																	//insert as between first and last
					this.bufChAM[idxCh].time.splice(i, 0, recTime);
					this.bufChAM[idxCh].val.splice(i, 0, val);
					this.bufChAM[idxCh].currIdx = i;
					// console.log(this.bufChAM[idxCh]);
					return;
				}
			}
		}
		if(i === len){																															//insert as last
			this.bufChAM[idxCh].time.push(recTime);
			this.bufChAM[idxCh].val.push(val);
			this.bufChAM[idxCh].currIdx = i;
			// console.log(this.bufChAM[idxCh]);
			return;
		}
	},
	/*----------------------------------------------------------------------------
	Insert Automation Buffer Data
	----------------------------------------------------------------------------*/
	InsertAmBufDat: function(recTime, val){
		// console.log('InsertAmBufDat');
		var len = this.bufAmTime.length;
		for(var i=0; i<len; i++){
			if(recTime < this.bufAmTime[i]){
				if(i === 0){										//insert as first index
					this.bufAmTime.unshift(recTime);
					this.bufAmVal.unshift(val);
					// console.log(this.bufAmTime, this.bufAmVal);
					return i;
				}else{													//insert as between first and last
					this.bufAmTime.splice(i, 0, recTime);
					this.bufAmVal.splice(i, 0, val);
					// console.log(this.bufAmTime, this.bufAmVal);
					return i;
				}
			}
		}
		if(i === len){											//insert as last
			this.bufAmTime.push(recTime);
			this.bufAmVal.push(val);
			// console.log(this.bufAmTime, this.bufAmVal);
			return i;
		}
	},
	/*============================================================================
	clear buffer of chAM for Move/Edit mode  
	============================================================================*/
	clrBufChAM: function(idxCh){
		this.bufChAM[idxCh].startIdx = null;
		this.bufChAM[idxCh].currIdx = null;
		this.bufChAM[idxCh].time = null;
		this.bufChAM[idxCh].val = null;
		this.bufChAM[idxCh].isClick = false;
	},
	/*============================================================================
	Draw Automation and Color Mark
	============================================================================*/
	drawAM: function(idxCh, times, dat, tgtIdx, mrkColor){
		// console.log('time:'+times+' dat:'+dat);
		var cvs = this.e_cvsAmForm[idxCh];
		var cvsCtx = cvs.getContext('2d');
		cvsCtx.clearRect(0, 0, cvs.width, cvs.height);		//clear rect

		// cvsCtx.strokeStyle = 'lightgray';
		cvsCtx.fillStyle = 'white';
		cvsCtx.strokeStyle = 'lightgray';

		//get automation type from select
		var idxTypeAM = this.e_slctAmType[idxCh].selectedIndex;

		/* make draw data --------------------------------------------------------*/
		var x = new Array(dat.length);
		var y = new Array(dat.length);
		switch(this.infoAM[idxTypeAM].type){
			case 'range':
				var min = this.infoAM[idxTypeAM].val[1];
				var max = this.infoAM[idxTypeAM].val[0];
				var delta = max - min;
				var adjH = cvs.height - this.mrkSide;
				for(var i=0, len=dat.length; i<len; i++){
					//x[i] = times[i] * this.currPxPerSec;																//rec time to px
					x[i] = times[i] * this.currPxPerSec + this.mrkSide/2;									//rec time to px
					// y[i] = (1 - (dat[i] - min) / delta) * cvs.height;									//value to px
					y[i] = (1 - (dat[i] - min) / delta) * adjH + this.mrkSide/2;					//value to px
				}
				break;
			case 'select':
				//console.log('select');
				//make array of height position for select value
				var numVal = this.infoAM[idxTypeAM].val.length;
				var posH = new Array(numVal);
				for(var i=0; i<numVal; i++){
					posH[i] = (i*2+1) / (numVal*2) * cvs.height;
				}
				//make draw data for select value
				for(var i=0, len=dat.length; i<len; i++){
					// x[i] = times[i] * this.currPxPerSec;																//rec time to px
					x[i] = times[i] * this.currPxPerSec + this.mrkSide/2;									//rec time to px
					for(var j=0; j<numVal; j++){
						if(dat[i] === this.infoAM[idxTypeAM].val[j]){
							y[i] = posH[j];
							break;
						}
					}
				} 
				break;
		}

		/* draw automation data --------------------------------------------------*/
		cvsCtx.beginPath();
		for(var i=0, len=times.length; i<len; i++){
			//Marker
			if(i === tgtIdx) cvsCtx.fillStyle = mrkColor;	//target datum marker color
			else cvsCtx.fillStyle = 'white';
			cvsCtx.fillRect(x[i]-this.mrkSide/2, y[i]-this.mrkSide/2, this.mrkSide, this.mrkSide);
			//Line
			if(i === 0){
				cvsCtx.moveTo(x[i], y[i]);
				cvsCtx.moveTo(x[i]+this.mrkSide/2, y[i]);
			}else{
				cvsCtx.lineTo(x[i], y[i-1]);
				cvsCtx.lineTo(x[i], y[i]);
			}
		}
		cvsCtx.stroke();
	},
	/*============================================================================
	Draw All Automation Data
	============================================================================*/
	drawAllAM: function(){
		for(var i=0; i<this.numTracks; i++){
			this.drawAmBg(i);
			this.redrawAmData(i);
		}
	},
	/*============================================================================
	Redraw automation data for a ch
	============================================================================*/
	redrawAmData: function(idxCh){
			if(this.currAmMode[idxCh] === this.bgcModeAM.modeEdit && this.bufChAM[idxCh].startIdx !== null){
				this.drawAM(idxCh, this.bufChAM[idxCh].time, this.bufChAM[idxCh].val, this.bufChAM[idxCh].startIdx, this.bgcModeAM.bgcEdit);
			}else{
				//get current Automation Type
				var idxTypeAM = this.e_slctAmType[idxCh].selectedIndex;
				//Draw Automation Data
				var chAM = objCombProc.getAmDat(idxCh, idxTypeAM); //get AM data
				this.drawAM(idxCh, chAM.time, chAM.val, null, '');
			}
	},
	/*============================================================================
	Set Automation Track View Height

	!Caution!
		1. changing canvas height by jQuery .height() doesn't work well.
			ex. $("."+self.name_cvsTrAmBg).eq(idxCh).height(tdCvsHeight);
		
		2. changing canvas height by jQuery .attr() work well. But, drwaing canvas doesn't work!
			ex. $("."+self.name_cvsTrAmBg).eq(idxCh).attr('height', String(tdCvsHeight)+'px');

		3. changing canvas height and drawing by JavaScript do work both well.
			ex. document.getElementByID(name_cvsTrAmBg+String(0)).height = tdCvsHeight;
	============================================================================*/
	setAmTrViewHeight: function(idxCh, tdCvsHeight){
		var self = this;
		//td - jQuery's CSS style
		$("."+self.name_tdAmView).eq(idxCh).height(tdCvsHeight);
		//canvas - JavaScript
		this.e_cvsAmBgForm[idxCh].height = tdCvsHeight;
		this.e_cvsAmForm[idxCh].height = tdCvsHeight;
	},
	/*============================================================================
	Drawing Automation data to Track
	============================================================================*/
	drawingAmDatToTrack(idxCh, typeAM){
		//get current Automation Type
		var idxTypeAM = this.e_slctAmType[idxCh].selectedIndex;

		if(!this.isDispAmTr[idxCh] || idxTypeAM !== typeAM) return; //non-disp AM Tr or diff curr AM Type

		var chAM = objCombProc.getAmDat(idxCh, idxTypeAM); //get AM data
		this.drawAM(idxCh, chAM.time, chAM.val, null, '');
	},


	/*****************************************************************************
	Play Line
	*****************************************************************************/
	initPlayLine: function(){
		this.e_cvsPlayLine = document.getElementById('cvsPlayLine');

		//Set playLine height
		//this.e_cvsPlayLine.style.height = String(self.numTracks * 62) + 'px';
		this.setPlayLineHeight();

		//Set PlayLine left
		this.e_cvsPlayLine.style.left = this.mrkSide/2 + 'px';
	},
	/*============================================================================
	Set play line height
	============================================================================*/
	setPlayLineHeight: function(){
		this.e_cvsPlayLine.style.height = String(this.e_tabTrView.clientHeight) + 'px';
	},
	/*============================================================================
	Set play line Position
	============================================================================*/
	setPlayLinePos: function(currPlayTime){
		// var pxPlayedTime = this.currPxPerSec * currPlayTime;
		var pxPlayedTime = this.currPxPerSec * currPlayTime + this.mrkSide/2;
		//console.log(pxPlayedTime);
		this.e_cvsPlayLine.style.left = pxPlayedTime + 'px';

		if(!this.isAutoScrollX) return;
		this.e_cvsTrScrollX.style.left =  String(pxPlayedTime / this.e_tabTrView.scrollWidth * this.rngScrollX) + 'px';

		// var diffPx = Math.abs(pxPlayedTime - this.e_divTrView.scrollLeft);
		// if( diffPx > this.e_divTrView.clientWidth){
		// 	this.e_divTrView.scrollLeft = Math.floor(pxPlayedTime / this.e_divTrView.clientWidth) * this.e_divTrView.clientWidth;
		// }
		if( (pxPlayedTime < this.e_divTrView.scrollLeft) || (pxPlayedTime > this.e_divTrView.scrollLeft+this.e_divTrView.clientWidth) ){
			this.e_divTrView.scrollLeft = Math.floor(pxPlayedTime);
			this.e_divTimeRuler.scrollLeft = Math.floor(pxPlayedTime);
		}
	},

}; //EOF objTrack


/*******************************************************************************
Mixer
*******************************************************************************/
var objMixer = {
	/* Navigation --------------------------------------------------------------*/
	navType: null,

	/* Mixer / Position common -------------------------------------------------*/
	idxOutputCh: null,		//Output Ch index
	partChNum:   null,		//Part Ch Number
	partChNames: null,		//Part Ch Names
	partChColors: null,		//Part Ch Colors
	imgDir: null,					//Img Files Directory
	imgFiles: null,				//Img Files
	instType: null,				//Instrument Type

	/* icon select -------------------------------------------------------------*/
	nameCb:  'cbInst',
	nameLbl: 'lblInst',
	idxForChgCol: 8,			//change col from first to second
	startSoundPos: null,
	currTimeArea: null,

	/* Position Mixer ----------------------------------------------------------*/
	//Position Mixer Area(layer 0)
	cvsPosMixArea: null,
	heightImgArea: null,
	widthImgArea:  null,

	//Position Mixer Graph(layer 1)
	cvsPosMixGraph: null,
	topOffset:    20,
	bottomOffset: 20,
	leftOffset:   20,
	rightOffset:  20,
	guideGrid:    10,
	widthDrawArea: null,
	heightDrawArea: null,

	//Position Mixer Icon(layer 2 to Max Part Ch.)
	imgSize:     50,
	imgBorder:   2,						//imgPosMix border is 2px
	attachedDiv: 'divPosMix',
	imgPosIcon:  'imgPosMix',
	imgPosMixLayerOffset: 2,
	imgIcons:   null,
	maxImgZidx: null,
	dndEvts: [],
	bufX: null,
	bufY: null,

	/* Mixer -------------------------------------------------------------------*/
	//Slide bar
	namePan:      'mixPan',			//Pan
	widthPan:     '80px',
	nameGain:     'mixGain',		//Gain(volume)
	widthGain:    '80px',

	//Button
	btnMixPanC: 'btnMixPanC',
	nameMute:   'mixMute',		//Mute
	nameSolo:   'mixSolo',		//Solo
	namePlayAM: 'mixPlayAM',	//Play AutoMation
	nameRecAM:  'mixRecAM',		//Rec AutoMation
	nameEffect:	'mixEffect',	//Effect
	colorDef:		'white',
	colorMute:  'yellow',			//button coler on Mute
	colorSolo:  'lightskyblue',	//button coler on Solo
	colorPlayAm:'lightgreen',
	colorRecAm:	'lightCoral',
	widthBtn:    '75px',			//Button width
	heightBtn:   '75px',			//Button height

	//Ch strip
	nameCh:  	 'mixCh',					//area each ch strip in <td>
	widthCh:   '100px',
	heightCh:  '230px',
	bgColorCh: 'lightgray',
	nameIcon:  'mixIcon',			//Part icon
	nameTag:   'mixTag',

	//Output Ch.
	idxOutputCh: null,

	actSrc:    null, //object source for linkage process(ie. Mixer -> CombProc -> Track, FX and so on) 
	enum_AM:   null, //automation param - index
	btnColors: null, //button colors for M,S,P,R


	/*============================================================================
	init
	============================================================================*/
	init: function(){
		/*Navigation -------------------------------------------------------------*/
		this.navType = objNavi.getNavType();

		/* Mixer / Position common -----------------------------------------------*/
		this.idxOutputCh = objCombProc.getOutputChIdx();	//Output Ch. index
		this.partChNum = objCombProc.getSoundsNum();
		this.partChNames = objCombProc.getChNames();
		this.partChColors = objCombProc.getPartChColor();
		var imgPath = objCombProc.getImgPath();
		this.imgDir = imgPath.dir;
		this.imgFiles = imgPath.files;
		this.instType = objCombProc.getInstType();				//instType
		var actSources = objCombProc.getActSrc();
		this.actSrc = actSources.mixer;										//object source for linkage process(ie. Mixer -> CombProc -> Track, FX and so on) 
		this.enum_AM = objCombProc.getEnumAM();						//Automation param - index

		/* Icon select -----------------------------------------------------------*/
		this.initIconSelect();

		/* Position Mixer --------------------------------------------------------*/
		this.initPosMix();

		/* Make Elements for number of Part Chs.----------------------------------*/
		this.initPartCh();

		/* EVENT: part ch --------------------------------------------------------*/
		this.initEventPartCh();

		/* EVENT: Output ---------------------------------------------------------*/
		this.initEvnetOutputCh();

		/* Set Each Ch. Pan, Gain to <range> and <img> ---------------------------*/
		var panGains = objCombProc.getAllChPanGainToSound();
		var len = panGains.pans.length;
		for(var i=0; i<len-1; i++){	//-1 measns outputCh.
			//<img> position mixer
			this.setPanFromVal(i, panGains.pans[i]);		//pan
			this.setGainFromVal(i, panGains.gains[i]);	//gain
			//<range>
			this.setPanToMixer(i, panGains.pans[i]);		//pan
			this.setGainToMixer(i, panGains.gains[i]);	//gain
		}
		//output ch's <range>
		this.setOutputGainToMixer(panGains.gains[i]);
		this.setOutputPanToMixer(panGains.pans[i]);
		//All <img> hidden
		$("."+this.imgPosIcon).css('visibility', 'hidden');

	},	//EOF init


	/*****************************************************************************
	Icon select
	*****************************************************************************/
	initIconSelect(){
		this.startSoundPos = objCombProc.getStartSoundPos();												//sound start position[sec]

		/* Button ----------------------------------------------------------------*/
		this.initIcnSelctBtn();

		/* CheckBox, Label -------------------------------------------------------*/
		this.initIconSelctCbAndLbl();
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Icon Select Button
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	initIcnSelctBtn: function(){
		var self = this;

		$(function(){
			$(".btnIcnSelct").mouseover(function(e){
				//Navigation -----------------------------------------------------------
				var idx = $(".btnIcnSelct").index(this);
				if(isNavi){
					switch(idx){
						case 0:
							objNavi.dispMsg(self.navType.mxIcnSelctAuto, e.clientX, e.clientY);		//Auto
							break;
						case 1:
							objNavi.dispMsg(self.navType.mxIcnSelctRythm, e.clientX, e.clientY);	//Rythm
							break;
						case 2:
							objNavi.dispMsg(self.navType.mxIcnSelctAllOn, e.clientX, e.clientY);	//All On
							break;
						case 3:
							objNavi.dispMsg(self.navType.mxIcnSelctAllOff, e.clientX, e.clientY);	//All Off
							break;
						case 4:
							objNavi.dispMsg(self.navType.mxIcnSelctPartA, e.clientX, e.clientY);	//Part A
							break;
						case 5:
							objNavi.dispMsg(self.navType.mxIcnSelctPartB, e.clientX, e.clientY);	//Part B
							break;
						case 6:
							objNavi.dispMsg(self.navType.mxIcnSelctPartC, e.clientX, e.clientY);	//Part C
							break;
					};
				}
			});
			$(".btnIcnSelct").mouseout(function(e){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation --------------------------------------------------------------
			$(".btnIcnSelct").click(function(){
				//console.log($(this).attr('name'));
				var idx = $(".btnIcnSelct").index(this);
				if(idx === 0){																											//Auto
					if(objCombProc.setAutoDispPosMixIconFromMixer()) $(this).css({'background-color':'orange'});
					else $(this).css({'background-color':'white'});
				}else{																															//except Auto
					//Disable Auto display Icon
					objCombProc.disableAutoDispPosMixIconFromMixer();
					$('#btnIcnSelct0').css({'background-color':'white'});
					self.currTimeArea = null;															//set null for next Auto icon select 
					self.dispIcnInAssignPart($(this).attr('name')); 
				}
			});
		});
	},
	/*============================================================================
	Display Icon in assgined Part 
	============================================================================*/
	dispIcnInAssignPart: function(part){
		var self = this;
		/* All On ----------------------------------------------------------------*/
		if(part === 'allOn'){
			$("."+self.nameCb).prop('checked', true);																	//CheckBox
			$("."+self.imgPosIcon).css('visibility', 'visible');											//Img
			return;
		}

	 	/* All Off ---------------------------------------------------------------*/
		$("."+self.nameCb).prop('checked', false);
		$("."+self.imgPosIcon).css('visibility', 'hidden');
		if(part === 'allOff' || part === 'end') return;

		/* Rythm & Chord ---------------------------------------------------------*/
		$("."+self.nameCb+".rythm").prop('checked', true);											//CheckBox
		$("."+self.imgPosIcon+".rythm").css('visibility', 'visible');						//Img
		if(part === 'rythm') return;

		/* Chord -----------------------------------------------------------------*/
		$("."+self.nameCb+".chord").prop('checked', true);
		$("."+self.imgPosIcon+".chord").css('visibility', 'visible');
		if(part === 'intro' || part === 'outro') return;

		/* Part ------------------------------------------------------------------*/
		switch(part){
			case 'partA':
				$("."+self.nameCb+".partA").prop('checked', true); 
				$("."+self.imgPosIcon+".partA").css('visibility', 'visible');
				break;
			case 'partB':
				$("."+self.nameCb+".partB").prop('checked', true); 
				$("."+self.imgPosIcon+".partB").css('visibility', 'visible');
				break;
			case 'partC':
				$("."+self.nameCb+".partC").prop('checked', true); 
				$("."+self.imgPosIcon+".partC").css('visibility', 'visible');
				break;
		}
	},
	/*============================================================================
	Auto display Position Mix Icon 
	============================================================================*/
	autoDispPosMixIcnToMixer: function(playedTime){
		for(var i=0, len=this.startSoundPos.length; i<len-1; i++){
			if(playedTime < this.startSoundPos[i+1][1]){
				if(this.currTimeArea === this.startSoundPos[i][0]) return;	//same time region doesn't need under proc.
			 	this.currTimeArea = this.startSoundPos[i][0];
				this.dispIcnInAssignPart(this.currTimeArea);
				return;
			}
		}
		//End of song
		if(this.currTimeArea === this.startSoundPos[i][0]) return;			//same time region doesn't need under proc.
	 	this.currTimeArea = this.startSoundPos[i][0];
		this.dispIcnInAssignPart(this.currTimeArea);
	},


	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Icon Select CheckBox and Label 
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	initIconSelctCbAndLbl: function(){
		var self = this;

		var topCb, leftCb, topLbl, leftLbl;
		var leftCol1 = 10;
		var leftCol2 = 130; 
		var topCbOffset = 49;
		var topCbPitch = 20;
		var leftLblOffset = 20;
		var topLblOffset = 2;
		var cbID;
		for(i=0; i<self.partChNum; i++){
			/* position for CheckBox and Label -------------------------------------*/
			if(i < self.idxForChgCol){
				topCb = String(topCbPitch * i + topCbOffset) + 'px';
				leftCb = String(leftCol1) + 'px';
				topLbl = String(topCbPitch * i + topCbOffset + topLblOffset) + 'px';
				leftLbl = String(leftCol1 + leftLblOffset) + 'px'
			}else{
				topCb = String(topCbPitch * (i-self.idxForChgCol) + topCbOffset) + 'px';
				leftCb = String(leftCol2) + 'px';
				topLbl = String(topCbPitch * (i-self.idxForChgCol) + topCbOffset + topLblOffset) + 'px';
				leftLbl = String(leftCol2 + leftLblOffset) + 'px'
			}

			/* checkbox ------------------------------------------------------------*/
			cbID =  self.nameCb + String(i);
			var $cb = $('<input type="checkbox" />')
				.attr("name", "instType")
				.attr("id", cbID)
				.attr("class", self.nameCb+' '+self.instType[i])
				.css({'left':leftCb, 'top':topCb})
				.appendTo("#divIconSelect");
			//label
			var $lbl = $('<label for='+cbID+'>'+ self.partChNames[i] + '</label>')
				.attr("id", self.nameLbl+String(i))
				.attr("class", self.nameLbl)
				.css({'left':leftLbl, 'top':topLbl})
				$("#divIconSelect").append($cb).append($lbl);
		}

		/* Navigation for icon SW ON / OFF ---------------------------------------*/
		$("."+self.nameLbl).mouseover(function(e){																	//Lael
			if(isNavi) objNavi.dispMsg(self.navType.mxIconChkBox, e.clientX, e.clientY);
		});
		$("."+self.nameLbl).mouseout(function(){
			if(isNavi) objNavi.hideMsg();
		});

		$("."+self.nameCb).mouseover(function(e){																		//checkbox
			if(isNavi) objNavi.dispMsg(self.navType.mxIconChkBox, e.clientX, e.clientY);
		});
		$("."+self.nameCb).mouseout(function(){
			if(isNavi) objNavi.hideMsg();
		});

		/* EVENT: Icon SW ON / OFF -----------------------------------------------*/
		$("."+self.nameCb).change(function(){
			var idx = $("."+self.nameCb).index(this);
			if(this.checked){
				$("."+self.imgPosIcon).eq(idx).css('visibility', 'visible');
				self.chgIconZindex(idx);																							//change z-index icon
			}else{
				$("."+self.imgPosIcon).eq(idx).css('visibility', 'hidden');
			}
			//Disable Auto icon display
			objCombProc.disableAutoDispPosMixIconFromMixer();
			$('#btnIcnSelct0').css({'background-color':'white'});

			this.blur(); //focus out
		})
	},


	/*****************************************************************************
	Position Mixer
	*****************************************************************************/
	initPosMix: function(){
		/* Img Position Area(layer 0) --------------------------------------------*/
		this.initPosMixArea();

		/* Img Position Graph(layer 1) -------------------------------------------*/
		this.initPosMixGraph();

		/* Img Position Icon(layer 2-Max Part Ch.) -------------------------------*/
		this.initPosMixIcon();
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Img Position Mixer Area(layer 0)
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	initPosMixArea: function(){
		//set Img movable width and height
		this.cvsPosMixArea = document.getElementById('cvsPosMixArea');
		this.widthImgArea = this.cvsPosMixArea.width - this.imgSize - this.imgBorder*2;
		this.heightImgArea = this.cvsPosMixArea.height - this.imgSize - this.imgBorder*2;
		//console.log('widthImgArea:' + this.widthImgArea + ' heightImgArea:' +  this.heightImgArea)
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Img Position Mixer Graph(Layer 1)
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	initPosMixGraph: function(){
		this.cvsPosMixGraph = document.getElementById('cvsPosMixGraph');
		var cvsCtx = this.cvsPosMixGraph.getContext('2d');
		cvsCtx.clearRect(0, 0, this.cvsPosMixGraph.width, this.cvsPosMixGraph.left);
		cvsCtx.fillStyle = 'rgb(0, 0, 0)';
		cvsCtx.fillRect(0, 0, this.cvsPosMixGraph.width, this.cvsPosMixGraph.left);

		//DrawArea
		this.widthDrawArea = this.cvsPosMixGraph.width - this.leftOffset - this.rightOffset;
		this.heightDrawArea = this.cvsPosMixGraph.height - this.topOffset - this.bottomOffset;

		//grid corner(left-top)
		cvsCtx.fillStyle = 'rgb(190, 190, 190)';
		cvsCtx.fillRect(this.leftOffset, this.topOffset, this.guideGrid, 1);
		cvsCtx.fillRect(this.leftOffset, this.topOffset, 1, this.guideGrid);

		//grid corner(right-top)
		cvsCtx.fillRect(this.cvsPosMixGraph.width-this.rightOffset-this.guideGrid, this.topOffset, this.guideGrid, 1);
		cvsCtx.fillRect(this.cvsPosMixGraph.width-this.rightOffset, this.topOffset, 1, this.guideGrid);

		//grid corner(left-bottome)
		cvsCtx.fillRect(this.leftOffset, this.cvsPosMixGraph.height-this.bottomOffset, this.guideGrid, 1);
		cvsCtx.fillRect(this.leftOffset, this.cvsPosMixGraph.height-this.bottomOffset-this.guideGrid, 1, this.guideGrid);

		//grid corner(right-bottom)
		cvsCtx.fillRect(this.cvsPosMixGraph.width-this.rightOffset-this.guideGrid, this.cvsPosMixGraph.height-this.bottomOffset, this.guideGrid, 1);
		cvsCtx.fillRect(this.cvsPosMixGraph.width-this.rightOffset, this.cvsPosMixGraph.height-this.bottomOffset-this.guideGrid, 1, this.guideGrid);

		//center line(horizontal)
		cvsCtx.fillRect(this.leftOffset, this.cvsPosMixGraph.height-this.bottomOffset-this.heightDrawArea/2, this.widthDrawArea, 1);

		//center line(vertical)
		cvsCtx.fillRect(this.leftOffset+this.widthDrawArea/2, this.topOffset, 1, this.heightDrawArea);

		//Pan Label
		cvsCtx.fillText('L', this.leftOffset-10, this.cvsPosMixGraph.height-this.bottomOffset-this.heightDrawArea/2+5);
		cvsCtx.fillText('R', this.cvsPosMixGraph.width-this.rightOffset+5, this.cvsPosMixGraph.height-this.bottomOffset-this.heightDrawArea/2+5);

		//Front/Rear Label
		cvsCtx.fillText('REAR', this.leftOffset+this.widthDrawArea/2-14, this.topOffset-5);
		cvsCtx.fillText('FRONT', this.leftOffset+this.widthDrawArea/2-17, this.cvsPosMixGraph.height-7);
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Img Mixer Icon(Layer 2 -)
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	initPosMixIcon: function(){
		var self = this;

		//set max Z-index for imgPoxMix
		this.maxImgZidx = this.partChNum + this.imgPosMixLayerOffset - 1;

		/* Set Icon --------------------------------------------------------------*/
		for(var i=0; i<self.partChNum; i++){
			$('<img></img>')
				.attr("id", self.imgPosIcon+String(i))
				.attr("class", self.imgPosIcon+' '+self.instType[i])
				.attr("src", self.imgDir+"/"+self.imgFiles[i])
				.attr("alt", "No image")
				.attr("width", String(self.imgSize)+"px")
				.attr("height", String(self.imgSize)+"px")
				.css({'position':'absolute', 'z-index':String(i+self.imgPosMixLayerOffset), 'top':'128px', 'left':'128px', 'background-color':self.partChColors[i], 'border-radius':'3px', 'border':'2px white solid'})
				.appendTo("#"+self.attachedDiv);
		}
		/* Navigation for Positon Mixer Icon -------------------------------------*/
		this.navPosMixIcon();

		/* Event: Position Mixer Icon  -------------------------------------------*/
		this.eventPosMixIcon();

	},
	/*============================================================================
	Navigation for Position Mixer Icons
	============================================================================*/
	navPosMixIcon: function(){
		var self = this;
		$(function(){
			$('.'+self.imgPosIcon).mousemove(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.mxPosMix, e.clientX, e.clientY);
			});
			$('.'+self.imgPosIcon).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});
		});
	},
	/*============================================================================
	Event: Position Mixer Icon(layer 2 - )
	============================================================================*/
	eventPosMixIcon: function(){
		var self = this;

		this.imgIcons = document.getElementsByClassName(this.imgPosIcon);
		for(var i=0, len=this.imgIcons.length; i<len; i++){
			var iconElem = this.imgIcons[i];
			var icn = new Draggabilly(iconElem, {containment: '#cvsPosMixArea'});

			/* Event: mouse click --------------------------------------------------*/
			icn.on('pointerDown', function(){
				self.bufX = self.bufY = null;
				var currIdx = parseInt( (this.element.id).replace(/imgPosMix/g, '') );
				objCombProc.setIsManOp(self.actSrc, currIdx, self.enum_AM.vol, true);	//manual operating
				objCombProc.setIsManOp(self.actSrc, currIdx, self.enum_AM.pan, true);	//manual operating
				//console.log(this.element.id);
				$('.'+self.nameLbl).eq(currIdx).css('background-color','orange');		//icon checkbox label
				self.chgIconZindex(currIdx); //change curr Icon Z-Index forefront 
			});
			/* Event: icon draggin -------------------------------------------------*/
			icn.on('dragMove', function(){
				var x = this.dragPoint.x + this.relativeStartPosition.x;
				var y = this.dragPoint.y + this.relativeStartPosition.y;
				if(self.bufX === x && self.bufY === y){															//check same value
					return;
				}else{
					self.bufX = x;
					self.bufY = y;
				}

				//console.log('mov X:' + x + ' mov Y:' + y);
				var pan = (x / self.widthImgArea - 0.5) * 3.14;	//3.14 is 1.57(maximum value for WebAudioAPI's pannerNode) / 0.5
				var gain = y / self.heightImgArea;
				//console.log('pan:' + pan + ' gain:' + gain);

				var currIdx = parseInt( (this.element.id).replace(/imgPosMix/g, '') );
				self.setPanGain(currIdx, pan, gain);
			});
			/* Event: icon drag end ------------------------------------------------*/
			icn.on('pointerUp', function(){
				self.bufX = self.bufY = null;
				var currIdx = parseInt( (this.element.id).replace(/imgPosMix/g, '') );
				objCombProc.setIsManOp(self.actSrc, currIdx, self.enum_AM.vol, false);	//end of manual operating
				objCombProc.setIsManOp(self.actSrc, currIdx, self.enum_AM.pan, false);	//end of manual operating
				$('.'+self.nameLbl).eq(currIdx).css('background-color','');					//icon checkbox label
			});
			self.dndEvts.push(icn);
		}

	},
	/*============================================================================
	Change Icon Z-Index
	============================================================================*/
	chgIconZindex: function(currIdx){
		var currZidx = parseInt(this.imgIcons[currIdx].style.zIndex);						//current zIndex
		if(currZidx === this.maxImgZidx) return;
		this.imgIcons[currIdx].style.zIndex = String(this.maxImgZidx);					//forefront zIndex 
		var zIdx;
		for(var i=0; i<this.partChNum; i++){
			zIdx = parseInt(this.imgIcons[i].style.zIndex);
			if(i !== currIdx && zIdx > currZidx){
				this.imgIcons[i].style.zIndex = String(--zIdx);  										//other zIndex decrease
			}
		}
	},
	/*============================================================================
	Set Volume And Pan 
	============================================================================*/
	setPanGain: function(idxCh, pan, gain){
		//set value to each slide bar 
		$('.'+this.namePan).eq(idxCh).val(String(pan));
		$('.'+this.nameGain).eq(idxCh).val(String(gain));
		
		objCombProc.setPanFromITMF(this.actSrc, idxCh, pan);
		objCombProc.setGainFromITMF(this.actSrc, idxCh, gain);
	},
	/*============================================================================
	Set Pan from Value  
	============================================================================*/
	setPanFromVal: function(idx, val){
		var strPan = String( (val / 3.14 + 0.5) *  this.widthImgArea  + this.leftOffset) + 'px';
		//console.log('idx:' + idx + ' val:' + val + ' strPan:' + strPan);
		$('.'+this.imgPosIcon).eq(idx).css('left', strPan);
	},
	/*============================================================================
	Set Gain from Value  
	============================================================================*/
	setGainFromVal: function(idx, val){
		var strGain = String(val * this.heightImgArea + this.topOffset) + 'px';
		$('.'+this.imgPosIcon).eq(idx).css('top', strGain);
	},


	/*****************************************************************************
	Part Chs.
	*****************************************************************************/
	/*============================================================================
	Make Elements for number of Part Chs.
	============================================================================*/
	initPartCh: function(){
		var self = this;
		var tdID;

		for(var i=0; i<self.partChNum; i++){
			/* part ch Console -----------------------------------------------------*/
			tdID = self.nameCh + String(i);
			$('<td></td>')
				.attr("width", self.widthCh)		//OK 
				.attr("height", self.heightCh)	//OK
				.attr("id", tdID)
				.attr("class", self.nameCh)
				.appendTo("#trConsole");
			/* Pan slidebar --------------------------------------------------------*/
			$('<input type="range" />')
				.attr("id", self.namePan + String(i))
				.attr("class", self.namePan)
				.attr("min", "-1.57")
				.attr("max", "1.57")
				.attr("step", "0.01")
				// .attr("value", "0")									//value doesn't work then useing .val("")
				.val("0")
				//.attr("width", self.widthPan)					//NG -> CSS configure
				//.attr("height", self.heightBtn)				//NG -> CSS configure
				//.attr("style", "position:absolute;")	//NG -> CSS configure
				.appendTo("#" + tdID);
			/* Gain slidebar -------------------------------------------------------*/
			$('<input type="range" />')
				.attr("id", self.nameGain + String(i))
				.attr("class", self.nameGain)
				.attr("min", "0.0")
				.attr("max", "1.0")
				.attr("value", "1.0")
				.attr("step", "0.01")
				//.attr("width", self.widthGain)				//NG -> CSS configure
				//.attr("height", self.heightBtn)				//NG -> CSS configure
				// .attr("style", "position:absolute;")	//NG -> CSS configure
				.appendTo("#" + tdID);
			/* Pan center button ---------------------------------------------------*/
				$('<input type="button" />')
				.attr("id", self.btnMixPanC+String(i))
				.attr("class", self.btnMixPanC)
				.attr("value", "C")
				// .attr("width", self.widthBtn)					//NG -> CSS configure
				// .attr("height", self.heightBtn)				//NG -> CSS configure
				// .attr("style", "position:absolute;")		//NG -> CSS configure
				.appendTo("#" + tdID);
			/* Mute button ---------------------------------------------------------*/
				$('<input type="button" />')
				.attr("id", self.nameMute + String(i))
				.attr("class", self.nameMute)
				.attr("value", "M")
				.appendTo("#" + tdID);
			/* Solo button ---------------------------------------------------------*/
			$('<input type="button" />')
				.attr("id", self.nameSolo + String(i))
				.attr("class", self.nameSolo)
				.attr("value", "S")
				.appendTo("#" + tdID);
			/* Rec AutoMation ------------------------------------------------------*/
			$('<input type="button" />')
				.attr("id", self.nameRecAM + String(i))
				.attr("class", self.nameRecAM)
				.attr("value", "R")
				.appendTo("#" + tdID);
			/* Play AutoMation -----------------------------------------------------*/
			$('<input type="button" />')
				.attr("id", self.namePlayAM + String(i))
				.attr("class", self.namePlayAM)
				.attr("value", "P")
				.appendTo("#" + tdID);
			/* Effect --------------------------------------------------------------*/
			$('<input type="button" />')
				.attr("id", self.nameEffect + String(i))
				.attr("class", self.nameEffect)
				.attr("value", "e")
				.appendTo("#" + tdID);
			/* Icon ----------------------------------------------------------------*/
			$('<img></img>')
				.attr("id", self.nameIcon + String(i))
				.attr("class", self.nameIcon)
				.attr("src", self.imgDir+"/"+self.imgFiles[i])
				.attr("alt", "No image")
				.attr("width", "50px")
				.attr("height", "50px")
				.css('background-color', self.partChColors[i])
				.appendTo("#" + tdID);
			/* Tag(Part Name) ------------------------------------------------------*/
			$('<span></span>')
				.attr("id", self.nameTag + String(i))
				.attr("class", self.nameTag)
				.text(self.partChNames[i])
				.css('background-color', self.partChColors[i])
				.appendTo("#" + tdID);
			}
	},
	/*============================================================================
	EVENT: Part ch
	============================================================================*/
	initEventPartCh: function(){
		this.btnColors = objCombProc.getBtnColors();	//button colors for M,S,P,R

		var self = this;
		$(function(){
			/* Gain ----------------------------------------------------------------*/
			//Navigation
			$('.'+self.nameGain).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.gain, e.clientX, e.clientY);
			});
			$('.'+self.nameGain).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('.'+self.nameGain).on('mousedown', function(){
				var idxCh = $('.'+self.nameGain).index(this);
				objCombProc.setIsManOp(self.actSrc, idxCh, self.enum_AM.vol, true);	//manual operating
			});

			$('.'+self.nameGain).on('input', function(){
				var idxCh = $('.'+self.nameGain).index(this);
				objCombProc.setGainFromITMF(self.actSrc, idxCh, parseFloat(this.value));	//Web Audio API
				self.setGainFromVal(idxCh, this.value);																		//Pos Mixer Icon
				self.chgIconZindex(idxCh);																								//Pos Icon Z-index
			});

			$('.'+self.nameGain).on('mouseup', function(){
				var idxCh = $('.'+self.nameGain).index(this);
				objCombProc.setIsManOp(self.actSrc, idxCh, self.enum_AM.vol, false);	//end of manual operating
			});


			/* Pan -----------------------------------------------------------------*/
			//NAvigation
			$('.'+self.namePan).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.pan, e.clientX, e.clientY);
			});
			$('.'+self.namePan).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('.'+self.namePan).on('mousedown', function(){
				var idxCh = $('.'+self.namePan).index(this);
				objCombProc.setIsManOp(self.actSrc, idxCh, self.enum_AM.pan, true);	//manual operating
			});

			$('.'+self.namePan).on('input', function(){
				var idxCh = $('.'+self.namePan).index(this);
				objCombProc.setPanFromITMF(self.actSrc, idxCh, parseFloat(this.value));	//Web Audio API
				self.setPanFromVal(idxCh, this.value);																	//Pos Mixer Icon
				self.chgIconZindex(idxCh);																							//Pos Icon Z-index
			});

			$('.'+self.namePan).on('mouseup', function(){
				var idxCh = $('.'+self.namePan).index(this);
				objCombProc.setIsManOp(self.actSrc, idxCh, self.enum_AM.pan, false);	//end of manual operating
			});


			/* Pan Center ----------------------------------------------------------*/
			//Navigation
			$('.'+self.btnMixPanC).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.centPan, e.clientX, e.clientY);
			});
			$('.'+self.btnMixPanC).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('.'+self.btnMixPanC).click(function(){
				var idxCh = $('.'+self.btnMixPanC).index(this);
				$('.'+self.namePan).eq(idxCh).val('0');															//set Pan Center(0)
				objCombProc.setPanFromITMF(self.actSrc, idxCh, parseFloat(0));			//Web Audio API
				self.setPanFromVal(idxCh, 0);																				//Pos Mixer Icon
				self.chgIconZindex(idxCh);																					//Pos Icon Z-index
			});


			/* Mute ----------------------------------------------------------------*/
			//Navigation
			$('.'+self.nameMute).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.mute, e.clientX, e.clientY);
			});
			$('.'+self.nameMute).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('.'+self.nameMute).click(function(){
				var idxCh = $('.'+self.nameMute).index(this);
				var chMode  = objCombProc.switchMuteFromITMF(self.actSrc, idxCh);
				self.setBtnColorForMuteToMixer(idxCh, chMode);
			});


			/* Solo ----------------------------------------------------------------*/
			//Navigation
			$('.'+self.nameSolo).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.solo, e.clientX, e.clientY);
			});
			$('.'+self.nameSolo).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('.'+self.nameSolo).click(function(){
				var idxCh = $('.'+self.nameSolo).index(this);
				var chModes = objCombProc.switchSoloFromITMF(self.actSrc, idxCh);
				self.setBtnColorForSoloToMixer(chModes);
			});

			/* Automation Rec ------------------------------------------------------*/
			//Navigation
			$('.'+self.nameRecAM).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.amRec, e.clientX, e.clientY);
			});
			$('.'+self.nameRecAM).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('.'+self.nameRecAM).click(function(){
				var idxCh = $('.'+self.nameRecAM).index(this);
				var chModeAM = objCombProc.switchAmRecFromITMF(self.actSrc, idxCh);
				self.setBtnColorForRecAmToMixer(idxCh, chModeAM);
			});

			/* Automation Play -----------------------------------------------------*/
			//Navigation
			$('.'+self.namePlayAM).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.amPlay, e.clientX, e.clientY);
			});
			$('.'+self.namePlayAM).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('.'+self.namePlayAM).click(function(){
				var idxCh = $('.'+self.namePlayAM).index(this);
				var chModeAM = objCombProc.switchAmPlayFromITMF(self.actSrc, idxCh);
				self.setBtnColorForPlayAmToMixer(idxCh, chModeAM);
			});

			/* e(Effect) -----------------------------------------------------------*/
			//Navigation
			$('.'+self.nameEffect).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.effect, e.clientX, e.clientY);
			});
			$('.'+self.nameEffect).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('.'+self.nameEffect).click(function(){
				var idxCh = $('.'+self.nameEffect).index(this);
				objCombProc.switchEffectFromITMF(self.actSrc, idxCh);
			});

			/* Img(icon) -----------------------------------------------------------*/
			//Navigation
			$('.'+self.nameIcon).mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.mxGenMixIcon, e.clientX, e.clientY);
			});
			$('.'+self.nameIcon).mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('.'+self.nameIcon).click(function(){
				var idxCh = $('.'+self.nameIcon).index(this);
				$("."+self.nameCb).eq(idxCh).prop('checked', true);									//CheckBox in Position Mixer
				$("."+self.imgPosIcon).eq(idxCh).css('visibility', 'visible');			//Img in Position Mixer
				self.chgIconZindex(idxCh);	//clicked Icon's Z-index is forefront.
			});

		});
	},
	/*============================================================================
	Set Gain value 
	============================================================================*/
	setGainToMixer: function(idxCh, gain){
		$('.'+this.nameGain).eq(idxCh).val( String(gain) );
		this.setGainFromVal(idxCh, gain);																						//Pos Mixer Icon
	},
	/*============================================================================
	Automation Play: Gain
	============================================================================*/
	playAmGainToMixer: function(idx, gain){
		if(!this.isManOp){
			$('.'+this.nameGain).eq(idx).val(String(gain));														//Slide bar
			this.setGainFromVal(idx, gain);																						//Pos Mixer Icon
		}
	},
	/*============================================================================
	Set Pan value 
	============================================================================*/
	setPanToMixer: function(idxCh, pan){
		$('.'+this.namePan).eq(idxCh).val( String(pan) );
		this.setPanFromVal(idxCh, pan);																							//Pos Mixer Icon
	},
	/*============================================================================
	Automation Play: Pan
	============================================================================*/
	playAmPanToMixer: function(idx, pan){
		$('.'+this.namePan).eq(idx).val(String(pan));																//Slide bar
		this.setPanFromVal(idx, pan);																								//Pos Mixer Icon
	},


	/*============================================================================
	Set Button Color for Mute To Mixer
	============================================================================*/
	setBtnColorForMuteToMixer: function(idxCh, chMode){
			this.cmnProcToSetBtnColorOfMuteSolo(idxCh, chMode);
	},
	/*============================================================================
	Set Button Color for Solo To Mixer
	============================================================================*/
	setBtnColorForSoloToMixer: function(chModes){
		for(var i=0, len=chModes.length; i<len; i++){
			this.cmnProcToSetBtnColorOfMuteSolo(i, chModes[i]);
		}
	},
	/*----------------------------------------------------------------------------
	common proc to set button color of Mute / Solo
	----------------------------------------------------------------------------*/
	cmnProcToSetBtnColorOfMuteSolo: function(idxCh, chMode){
		switch(chMode){
			case 'solo':
					$('.'+this.nameMute).eq(idxCh).css('background-color', this.btnColors.norm);
					$('.'+this.nameSolo).eq(idxCh).css('background-color', this.btnColors.solo);
				break;
			case 'mute':
					$('.'+this.nameMute).eq(idxCh).css('background-color', this.btnColors.mute);
					$('.'+this.nameSolo).eq(idxCh).css('background-color', this.btnColors.norm);
				break;
			default:
					$('.'+this.nameSolo).eq(idxCh).css('background-color', this.btnColors.norm);
					$('.'+this.nameMute).eq(idxCh).css('background-color', this.btnColors.norm);
			break;
		};
	},
	/*============================================================================
	Set Button Color for Rec Automation To Mixer
	============================================================================*/
	setBtnColorForRecAmToMixer: function(idxCh, chModeAM){
		this.cmnProcToSetBtnColorOfRecPlayAM(idxCh, chModeAM);
	},
	/*============================================================================
	Set Button Color for Play Automation To Mixer
	============================================================================*/
	setBtnColorForPlayAmToMixer: function(idxCh, chModeAM){
		this.cmnProcToSetBtnColorOfRecPlayAM(idxCh, chModeAM);
	},
	/*----------------------------------------------------------------------------
	common proc to set button color of Mute / Solo
	----------------------------------------------------------------------------*/
	cmnProcToSetBtnColorOfRecPlayAM: function(idxCh, chModeAM){
		switch(chModeAM){
			case 'rec':
				$('.'+this.nameRecAM).eq(idxCh).css('background-color', this.btnColors.recAM);
				$('.'+this.namePlayAM).eq(idxCh).css('background-color', this.btnColors.norm);
				break;
			case 'play':
				$('.'+this.nameRecAM).eq(idxCh).css('background-color', this.btnColors.norm);
				$('.'+this.namePlayAM).eq(idxCh).css('background-color', this.btnColors.playAM);
				break;
			default:
			$('.'+this.nameRecAM).eq(idxCh).css('background-color', this.btnColors.norm);
			$('.'+this.namePlayAM).eq(idxCh).css('background-color', this.btnColors.norm);
			break;
		}
	},
	/*============================================================================
	Set Button Color All Part Ch For Norm to Mixer
	============================================================================*/
	setBtnColorAllPartChForNormToMixer: function(){
		var self = this;
		$(function(){
			$('.'+self.nameMute).css('background-color', self.btnColors.norm);
			$('.'+self.nameSolo).css('background-color', self.btnColors.norm);
		});
	},


	/*****************************************************************************
	OUTPUT Ch.
	*****************************************************************************/
	/*============================================================================
	EVENT: clicked Pan, Gain, Mute, e(FX), Icon
	============================================================================*/
	initEvnetOutputCh: function(){
		var self = this;
		$(function(){
			/* Pan -----------------------------------------------------------------*/
			//Navigation
			$('#outputPan').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.pan, e.clientX, e.clientY);
			});
			$('#outputPan').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#outputPan').on('input', function(){
				objCombProc.setOutputPanFromMF(self.actSrc, parseFloat(this.value));
			});

			/* Gain ----------------------------------------------------------------*/
			//Navigation
			$('#outputGain').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.gain, e.clientX, e.clientY);
			});
			$('#outputGain').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#outputGain').on('input', function(){
				objCombProc.setOutputGainFromMF(self.actSrc, parseFloat(this.value));
			});

			/* Pan center ----------------------------------------------------------*/
			//Navigation
			$('#btnOutputPanC').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.centPan, e.clientX, e.clientY);
			});
			$('#btnOutputPanC').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#btnOutputPanC').click(function(){
				$('#outputPan').val("0");
				objCombProc.setOutputPanFromMF(self.actSrc, parseFloat(0));
			});

			/* Mute ----------------------------------------------------------------*/
			//Navigation
			$('#btnOutputMute').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.mute, e.clientX, e.clientY);
			});
			$('#btnOutputMute').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#btnOutputMute').click(function(){
				var chMode = objCombProc.switchOutputMuteFromMF(self.actSrc);
				self.setBtnColorForOutputMuteToMixer(chMode);
			});

			/*e (Effect) -----------------------------------------------------------*/
			//Navigation
			$('#btnOutputEffect').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.effect, e.clientX, e.clientY);
			});
			$('#btnOutputEffect').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#btnOutputEffect').click(function(){
				objCombProc.switchEffectFromITMF(self.actSrc, self.idxOutputCh);
			});

			/* Icon ----------------------------------------------------------------*/
			var outputIcon = document.getElementById('outputIcon');
			outputIcon.src = self.imgDir+'/'+self.imgFiles[self.idxOutputCh];
			outputIcon.style.backgroundColor = self.partChColors[self.idxOutputCh];

			/* Ch. Tag -------------------------------------------------------------*/
			var chTag = document.getElementById('outputTag');
			chTag.style.backgroundColor = self.partChColors[self.idxOutputCh];
		});
	},
	/*============================================================================
	Set Output Gain Value to Mixer
	============================================================================*/
	setOutputGainToMixer: function(gain){
		$('#outputGain').val( String(gain) );
	},
	/*============================================================================
	Set Output Pan Value to Mixer
	============================================================================*/
	setOutputPanToMixer: function(pan){
		$('#outputPan').val( String(pan) );
	},
	/*============================================================================
	Set Button Color for Output Mute To Mixer
	============================================================================*/
	setBtnColorForOutputMuteToMixer: function(chMode){
		if(chMode === 'mute'){
			$('#btnOutputMute').css('background-color', this.btnColors.mute);
		}else{
			$('#btnOutputMute').css('background-color', this.btnColors.norm);
		}
	},
	/*============================================================================
	Set Output Ch param  To Mixer
	============================================================================*/
	setOutputChParamToMixer: function(outputChParam){
		this.setOutputGainToMixer(outputChParam.gain);															//Gain
		this.setOutputPanToMixer(outputChParam.pan);																//Pan
		this.setBtnColorForOutputMuteToMixer(outputChParam.chMode);									//Ch Mode
	},
};	//EOF objMixer



/*******************************************************************************
FX(Effect)
*******************************************************************************/
var objFX = {
	actSrc:    null,	//object source for linkage process(ie. Mixer -> CombProc -> Track, FX and so on) 
	enum_AM:   null,	//Automation param - index
	btnColors: null,	//Mute/Solo, Automation Rec/Play

	/* Navigation --------------------------------------------------------------*/
	navType: null,		//navigation type

	/* Cross Browser -----------------------------------------------------------*/
	isMacFirefox: false,	//true: use .blur() of <select>, false: no-usage .blur() of select

	/* Ch. Select --------------------------------------------------------------*/
	chNames:     null,
	partChColor: null,
	imgDir:      null,
	imgFiles:    null, 
	idxOutputCh: null,
	selectCh:    null,
	spnPrevCh:   null,
	spnNextCh:   null,
	cvsPrevCh:   null,
	cvsNextCh:   null,
	imgCurrCh:   null,
	imgPrevCh:   null,
	imgNextCh:   null,
	rngGain:     null,
	rngPan:      null,
	btnCenter:   null,
	btnMute:     null,
	btnSolo:     null,
	btnRecAM:    null,
	btnPlayAM:   null,

	/* Diagram -----------------------------------------------------------------*/
	filterNames: null,

	cvsRtSw: null,
	cvsRouting: null,
	cvsFilterFig0: null,
	cvsFilterFig1: null,
	cvsFilterFig2: null,
	cvsFilterFig3: null,
	cvsCompFig: null,

	/*============================================================================
	init
	============================================================================*/
	init: function(){
		var actSources = objCombProc.getActSrc();
		this.actSrc = actSources.fx;											//object source for linkage process
		this.chNames = objCombProc.getChNames();
		this.partChColor = objCombProc.getPartChColor();
		var imgPath = objCombProc.getImgPath();
		this.imgDir = imgPath.dir;
		this.imgFiles = imgPath.files;
		this.idxOutputCh = objCombProc.getOutputChIdx();
		this.filterNames = objCombProc.getFilterNames();

		/* Navigation ------------------------------------------------------------*/
		this.navType = objNavi.getNavType();

		/* Select Ch -------------------------------------------------------------*/
		this.selectCh = document.getElementById('selectFxCh');
		this.imgCurrCh = document.getElementById('imgCurrCh');
		this.initSelectCh();

		/* Prev/Next Ch ----------------------------------------------------------*/
		this.spnPrevCh = document.getElementById('spnPrevCh');
		this.spnNextCh = document.getElementById('spnNextCh');
		this.imgPrevCh = document.getElementById('imgPrevCh');
		this.imgNextCh = document.getElementById('imgNextCh');
		this.initPrevNextCh();

		/* init FX Console -------------------------------------------------------*/
		this.initConsole();

		/* Diagram ---------------------------------------------------------------*/
		this.initDiagram();

		/* Set each param - objFX, objEQ and objComp -----------------------------*/
		var fxCh = objCombProc.getFxCh();
		objCombProc.switchEffectFromITMF(this.actSrc, fxCh);
	},	//EOF init

	/*****************************************************************************
	Select Ch for Part / Master Out
	*****************************************************************************/
	initSelectCh(){
		var self = this;
		/* INIT ------------------------------------------------------------------*/
		var fxCh = objCombProc.getFxCh();
		$(function($){
			for(var i=0, len=self.chNames.length; i<len; i++){
				$("#selectFxCh").append($("<option>").val(String(i)).text(self.chNames[i]));
				if(i === fxCh){
					$("#selectFxCh").prop('selectedIndex', fxCh);	//select current Part Ch.
					self.imgCurrCh.src = self.imgDir + '/' + self.imgFiles[i];
				} 
			}
			$("#selectFxCh").prop('disabled', false);
		});

		/* Navigation ------------------------------------------------------------*/
		$("#selectFxCh").mouseover(function(e){
			if(isNavi) objNavi.dispMsg(self.navType.fxSlctCh, e.clientX, e.clientY);
		});
		$("#selectFxCh").mouseout(function(){
			if(isNavi) objNavi.hideMsg();
		});

		/* EVENT -----------------------------------------------------------------*/
		//focus out for short cut key 'space' on Mac Firefox
		$("#selectFxCh").click('click', function(e){
			if(self.isMacFirefox) e.target.blur();
		});

		$(function($){
			$("#selectFxCh").change(function(e){
				objCombProc.switchEffectFromITMF(self.actSrc, this.selectedIndex);
			});
		});
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Cross Browser
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Set isBlur to FX
	============================================================================*/
	setIsBlurToFX: function(){
		this.isMacFirefox = true;
	},


	/*****************************************************************************
	Prev / Next Ch.
	*****************************************************************************/
	initPrevNextCh: function(){
		var self = this;

		/* INIT: drawing prev / next marker --------------------------------------*/
		this.cvsPrevCh = document.getElementById('cvsPrevCh');
		var cvsCtx = this.cvsPrevCh.getContext('2d');
		cvsCtx.clearRect(0, 0, this.cvsPrevCh.width, this.cvsPrevCh.height);
		cvsCtx.fillStyle = 'rgb(256, 256, 256)';
		cvsCtx.beginPath();
		cvsCtx.moveTo(0, this.cvsPrevCh.height/2);
		cvsCtx.lineTo(this.cvsPrevCh.width, 0);
		cvsCtx.lineTo(this.cvsPrevCh.width, this.cvsPrevCh.height);
		cvsCtx.fill();

		this.cvsNextCh = document.getElementById('cvsNextCh');
		cvsCtx = this.cvsNextCh.getContext('2d');
		cvsCtx.clearRect(0, 0, this.cvsNextCh.width, this.cvsNextCh.height);
		cvsCtx.fillStyle = 'rgb(256, 256, 256)';
		cvsCtx.beginPath();
		cvsCtx.moveTo(0, 0);
		cvsCtx.lineTo(this.cvsNextCh.width, this.cvsNextCh.height/2);
		cvsCtx.lineTo(0, this.cvsNextCh.height);
		cvsCtx.fill();

		/* Navigation ------------------------------------------------------------*/
		//Prev Ch Mark
		this.cvsPrevCh.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.fxPrevMrk, e.clientX, e.clientY);
		}
		this.cvsPrevCh.onmouseout= function(){
			if(isNavi) objNavi.hideMsg();
		}

		this.imgPrevCh.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.fxPrevMrk, e.clientX, e.clientY);
		}
		this.imgPrevCh.onmouseout= function(){
			if(isNavi) objNavi.hideMsg();
		}


		//Next Ch Mark
		this.cvsNextCh.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.fxNextMrk, e.clientX, e.clientY);
		}
		this.cvsNextCh.onmouseout= function(){
			if(isNavi) objNavi.hideMsg();
		}

		this.imgNextCh.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.fxNextMrk, e.clientX, e.clientY);
		}
		this.imgNextCh.onmouseout= function(){
			if(isNavi) objNavi.hideMsg();
		}


		/* EVENT -----------------------------------------------------------------*/
		//Click Prev Ch Mark
		this.cvsPrevCh.onclick = function(){
			self.selctPrevOrNextChProc(true);
		}
		//Click Prev Ch. Img
		this.imgPrevCh.onclick = function(){
			self.selctPrevOrNextChProc(true);
		}

		//Click Next Ch Mark
		this.cvsNextCh.onclick = function(){
			self.selctPrevOrNextChProc(false);
		}
		//Click Next Ch. Img
		this.imgNextCh.onclick = function(){
			self.selctPrevOrNextChProc(false);
		}
	},
	/*----------------------------------------------------------------------------
	Select Prev or Next Ch. Proc for event
	----------------------------------------------------------------------------*/
	selctPrevOrNextChProc: function(isPrev){
		//change fxCh from prev or next Ch.
		if(isPrev){																																	//Prev.Ch
			if(this.selectCh.selectedIndex === 0) this.selectCh.selectedIndex = this.idxOutputCh;
			else --this.selectCh.selectedIndex;
		}else{																																			//Next Ch.
			if(this.selectCh.selectedIndex === this.idxOutputCh) this.selectCh.selectedIndex = 0;
			else ++this.selectCh.selectedIndex;
		}
		//set changed current Ch.
		objCombProc.switchEffectFromITMF(this.actSrc, this.selectCh.selectedIndex);
	},
	/*============================================================================
	Set Each Ch Name and Fig to Span and Img
	============================================================================*/
	setFxChParam: function(idxCurrCh, paramConsole){
		/* Current Part Ch. ------------------------------------------------------*/
		//<select>
		if(this.selectCh.selectedIndex !== idxCurrCh) this.selectCh.selectedIndex = idxCurrCh;
		//pan
		this.setPanToFX(paramConsole.pan);
		//gain
		this.setGainToFX(paramConsole.gain);
		//Mute/Solo
		this.cmnProcToSetBtnColorOfMuteSolo(paramConsole.chMode);
		//Automation Rec/Play
		this.cmnProcToSetBtnColorOfRecPlayAM(paramConsole.chModeAM);
		//Button display: Solo, AM Rec, AM Play
		if(idxCurrCh === this.idxOutputCh){
			$('#btnSoloFX').css('display', 'none');			//Solo
			$('#btnRecAmFX').css('display', 'none');		//AM Rec
			$('#btnPlayAmFX').css('display', 'none');		//AM Play
		}else{
			$('#btnSoloFX').css('display', 'block');		//Solo
			$('#btnRecAmFX').css('display', 'block');		//AM Rec
			$('#btnPlayAmFX').css('display', 'block');	//AM Play
		}
		//<img>
		this.imgCurrCh.src = this.imgDir + '/' + this.imgFiles[idxCurrCh];
		this.imgCurrCh.style.backgroundColor = this.partChColor[idxCurrCh];


		/* Previous Part Ch. -----------------------------------------------------*/
		var idxPrev = idxCurrCh - 1;
		if(idxPrev === -1) idxPrev = this.idxOutputCh; 
		//<span>
		this.spnPrevCh.innerHTML = this.chNames[idxPrev];
		this.spnPrevCh.style.backgroundColor = this.partChColor[idxPrev];
		//<img>
		this.imgPrevCh.src = this.imgDir + '/' + this.imgFiles[idxPrev];
		this.imgPrevCh.style.backgroundColor = this.partChColor[idxPrev];


		/* Next Part Ch. ---------------------------------------------------------*/
		var idxNext = idxCurrCh + 1;
		if(idxNext === this.idxOutputCh + 1 ) idxNext = 0;
		//<span>
		this.spnNextCh.innerHTML = this.chNames[idxNext];
		this.spnNextCh.style.backgroundColor = this.partChColor[idxNext];
		//<img>
		this.imgNextCh.src = this.imgDir + '/' + this.imgFiles[idxNext];
		this.imgNextCh.style.backgroundColor = this.partChColor[idxNext];
	},

	/*****************************************************************************
	Console
	*****************************************************************************/
	initConsole: function(){
		this.enum_AM = objCombProc.getEnumAM();				//Automation param - index
		this.btnColors = objCombProc.getBtnColors();	//button colors for M,S,R,P

		var self = this;
		$(function(){
			/* Gain ----------------------------------------------------------------*/
			//Navigation
			$('#rngGainFX').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.gain, e.clientX, e.clientY);
			});
			$('#rngGainFX').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#rngGainFX').on('mousedown', function(){
				if(self.selectCh.selectedIndex !== self.idxOutputCh){
					objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.vol, true);		//manual operating
				}
			});

			$('#rngGainFX').on('input', function(){
				if(self.selectCh.selectedIndex === self.idxOutputCh){										//Ouput Ch.
					objCombProc.setOutputGainFromMF(self.actSrc, parseFloat(this.value));
				}else{																																	//Part Ch.
					objCombProc.setGainFromITMF(self.actSrc, null, parseFloat(this.value));
				}
			});

			$('#rngGainFX').on('mouseup', function(){
				if(self.selectCh.selectedIndex !== self.idxOutputCh){
					objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.vol, false);		//end of manual operating 
				}
			});


			/* Pan -----------------------------------------------------------------*/
			//Navigation
			$('#rngPanFX').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.pan, e.clientX, e.clientY);
			});
			$('#rngPanFX').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#rngPanFX').on('mousedown', function(){
				if(self.selectCh.selectedIndex !== self.idxOutputCh){
					objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.pan, true);		//manual operating
				}
			});

			$('#rngPanFX').on('input', function(){
				if(self.selectCh.selectedIndex === self.idxOutputCh){										//Ouput Ch.
					objCombProc.setOutputPanFromMF(self.actSrc, parseFloat(this.value));
				}else{																																	//Part Ch.
					objCombProc.setPanFromITMF(self.actSrc, null, parseFloat(this.value));
				}
			});

			$('#rngPanFX').on('mouseup', function(){
				if(self.selectCh.selectedIndex !== self.idxOutputCh){
					objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.pan, false);			//end of manual operating 
				}
			});


			/* Pan center ----------------------------------------------------------*/
			//Navigation
			$('#btnCenterFX').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.centPan, e.clientX, e.clientY);
			});
			$('#btnCenterFX').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#btnCenterFX').click(function(){
				$('#rngPanFX').val("0");
				if(self.selectCh.selectedIndex === self.idxOutputCh){										//Ouput Ch.
					objCombProc.setOutputPanFromMF(self.actSrc, parseFloat(0));
				}else{																																	//Part Ch.
					objCombProc.setPanFromITMF(self.actSrc, null, parseFloat(0));
				}
			});


			/* Mute ----------------------------------------------------------------*/
			//Navigation
			$('#btnMuteFX').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.mute, e.clientX, e.clientY);
			});
			$('#btnMuteFX').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#btnMuteFX').click(function(){
				if(self.selectCh.selectedIndex === self.idxOutputCh){										//Ouput Ch.
					var chMode  = objCombProc.switchOutputMuteFromMF(self.actSrc);
				}else{																																	//Part Ch.
					var chMode  = objCombProc.switchMuteFromITMF(self.actSrc , null);
				}
				self.setBtnColorForMuteToFX(chMode);
			});


			/* Solo ----------------------------------------------------------------*/
			//Navigation
			$('#btnSoloFX').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.solo, e.clientX, e.clientY);
			});
			$('#btnSoloFX').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#btnSoloFX').click(function(){
				var chMode  = objCombProc.switchSoloFromITMF(self.actSrc , null);
				self.setBtnColorForMuteToFX(chMode);
			});


			/* Automation Rec ------------------------------------------------------*/
			//Navigation
			$('#btnRecAmFX').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.amRec, e.clientX, e.clientY);
			});
			$('#btnRecAmFX').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#btnRecAmFX').click(function(){
				var chModeAM = objCombProc.switchAmRecFromITMF(self.actSrc, null);
				self.setBtnColorForRecAmToFX(chModeAM);
			});


			/* Automation Play -----------------------------------------------------*/
			//Navigation
			$('#btnPlayAmFX').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.amPlay, e.clientX, e.clientY);
			});
			$('#btnPlayAmFX').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//Operation
			$('#btnPlayAmFX').click(function(){
				var chModeAM = objCombProc.switchAmPlayFromITMF(self.actSrc, null);
				self.setBtnColorForPlayAmToFX(chModeAM);
			});

		});
	},
	/*============================================================================
	Set Gain Value to FX
	============================================================================*/
	setGainToFX: function(gain){
		$('#rngGainFX').val( String(gain) );
	},
	/*============================================================================
	Play Automation Gain to FX
	============================================================================*/
	playAmGainToFX: function(gain){
		this.setGainToFX(gain);
	},
	/*============================================================================
	Set Pan Value to FX
	============================================================================*/
	setPanToFX: function(pan){
		$('#rngPanFX').val( String(pan) );
	},
	/*============================================================================
	Play Automation Pan to FX
	============================================================================*/
	playAmPanToFX: function(pan){
		this.setPanToFX(pan);
	},
	/*============================================================================
	Set Button Color for Mute To FX
	============================================================================*/
	setBtnColorForMuteToFX: function(chMode){
		this.cmnProcToSetBtnColorOfMuteSolo(chMode);
	},
	/*============================================================================
	Set Button Color for Solo To FX
	============================================================================*/
	setBtnColorForSoloToFX: function(chMode){
		this.cmnProcToSetBtnColorOfMuteSolo(chMode);
	},
	/*----------------------------------------------------------------------------
	common proc to set button color of Mute / Solo
	----------------------------------------------------------------------------*/
	cmnProcToSetBtnColorOfMuteSolo: function(chMode){
		switch(chMode){
			case 'solo':
				$('#btnSoloFX').css('background-color', this.btnColors.solo);
				$('#btnMuteFX').css('background-color', this.btnColors.norm);
				break;
			case 'mute':
				$('#btnMuteFX').css('background-color', this.btnColors.mute);
				$('#btnSoloFX').css('background-color', this.btnColors.norm);
				break;
			default:
				$('#btnSoloFX').css('background-color', this.btnColors.norm);
				$('#btnMuteFX').css('background-color', this.btnColors.norm);
			break;
		}
	},
	/*============================================================================
	Set Button Color for Rec Automation To FX
	============================================================================*/
	setBtnColorForRecAmToFX: function(chModeAM){
		this.cmnProcToSetBtnColorOfRecPlayAM(chModeAM);
	},
	/*============================================================================
	Set Button Color for Play Automation To FX
	============================================================================*/
	setBtnColorForPlayAmToFX: function(chModeAM){
		this.cmnProcToSetBtnColorOfRecPlayAM(chModeAM);
	},
	/*----------------------------------------------------------------------------
	common proc to set button color of Automation Rec / Play
	----------------------------------------------------------------------------*/
	cmnProcToSetBtnColorOfRecPlayAM: function(chModeAM){
		switch(chModeAM){
			case 'rec':
				$('#btnRecAmFX').css('background-color', this.btnColors.recAM);
				$('#btnPlayAmFX').css('background-color', this.btnColors.norm);
				break;
			case 'play':
				$('#btnRecAmFX').css('background-color', this.btnColors.norm);
				$('#btnPlayAmFX').css('background-color', this.btnColors.playAM);
				break;
			default:
				$('#btnRecAmFX').css('background-color', this.btnColors.norm);
				$('#btnPlayAmFX').css('background-color', this.btnColors.norm);
			break;
		}
	},
	/*============================================================================
	Set Button Color For Norm to FX
	============================================================================*/
	setBtnColorForNormToFX: function(){
		$('#btnSoloFX').css('background-color', this.btnColors.norm);
		$('#btnMuteFX').css('background-color', this.btnColors.norm);
	},


	/*****************************************************************************
	Diagram
	*****************************************************************************/
	initDiagram: function(){
		this.cvsRtSwFig = document.getElementById('cvsRtSwFig');
		this.cvsRouting = document.getElementById('cvsRouting');
		this.cvsFilterFig0 = document.getElementById('cvsFilterFig0');
		this.cvsFilterFig1 = document.getElementById('cvsFilterFig1');
		this.cvsFilterFig2 = document.getElementById('cvsFilterFig2');
		this.cvsFilterFig3 = document.getElementById('cvsFilterFig3');
		this.cvsCompFig = document.getElementById('cvsCompFig');

		/* FX Dialog -------------------------------------------------------------*/
		this.drawFxDialog();

		/* EQ section ------------------------------------------------------------*/
		this.drawLowShelf();	//Filter No.1(index:0)
		this.drawPeaking(1);	//Filter No.2(index:1)
		this.drawPeaking(2);	//Filter No.3(index:2)
		this.drawHighShelf();	//Filter No.4(index:3)
		$('.cvsFig').css('visibility', 'hidden');	//Filter icon all off
		this.swEqModeToFX(false);									//EQ SW:OFF

		/* Compressore section ---------------------------------------------------*/
		this.drawCompCurve();
		this.swCompModeToFX(false);								//Comp SW: OFF
	},
	/*============================================================================
	Drawing FX Dialog
	============================================================================*/
	drawFxDialog(){
		this.cvsRouting = this.cvsRouting;
		var cvsCtx = this.cvsRouting.getContext('2d');
		cvsCtx.clearRect(0, 0, this.cvsRouting.width, this.cvsRouting.height);
		cvsCtx.fillStyle = 'rgb(255, 255, 255)';
		cvsCtx.strokeStyle = 'rgb(255, 255, 255)';
		cvsCtx.lineWidth = 1;

		/* Input section ---------------------------------------------------------*/
		//Triangle - Input
		var itl = 20;
		var itt = 85;
		var itwh = 10;
		cvsCtx.beginPath();
		cvsCtx.moveTo(itl, itt);
		cvsCtx.lineTo(itl+itwh, itt+itwh/2);
		cvsCtx.lineTo(itl, itt+itwh);
		cvsCtx.fill();

		//Line from Input Triangle to Node1
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(20, 90);
		cvsCtx.lineTo(40, 90);
		cvsCtx.stroke();

		/* EQ section ------------------------------------------------------------*/
		//circle - EQ input node
		cvsCtx.beginPath();
		cvsCtx.arc(44, 65, 4, 0, Math.PI*2, false);
		cvsCtx.stroke();

		//circle - Input Node
		cvsCtx.beginPath();
		cvsCtx.arc(44, 90, 4, 0, Math.PI*2, false);
		cvsCtx.stroke();

		//circle - EQ Bypass node
		cvsCtx.beginPath();
		cvsCtx.arc(44, 115, 4, 0, Math.PI*2, false);
		cvsCtx.stroke();

		//Line - EQ through
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(48, 65);
		cvsCtx.lineTo(223, 65);
		cvsCtx.stroke();

		//Line  - EQ Bypass
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(48, 115);
		cvsCtx.lineTo(223, 115);
		cvsCtx.stroke();

		//Rect - EQ
		cvsCtx.lineWidth = 1;
		cvsCtx.beginPath();
		cvsCtx.strokeRect(58, 50, 155, 48);

		//vertical Line EQ out and Bypass
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(223, 65);
		cvsCtx.lineTo(223, 140);
		cvsCtx.stroke();

		//circle - EQ or Bypass junction node
		cvsCtx.beginPath();
		cvsCtx.arc(223, 115, 4, 0, Math.PI*2, false);
		cvsCtx.fill();

		//hirizontal Line  
		cvsCtx.beginPath();
		cvsCtx.moveTo(25, 140);
		cvsCtx.lineTo(223, 140);
		cvsCtx.stroke();

		//vertical line
		cvsCtx.beginPath();
		cvsCtx.moveTo(25, 140);
		cvsCtx.lineTo(25, 208);
		cvsCtx.stroke();

		//horizontal line
		cvsCtx.beginPath();
		cvsCtx.moveTo(25, 208);
		cvsCtx.lineTo(40, 208);
		cvsCtx.stroke();

		/* Comp section ----------------------------------------------------------*/
		//circle - Comp input node
		cvsCtx.beginPath();
		cvsCtx.arc(44, 183, 4, 0, Math.PI*2, false);
		cvsCtx.stroke();

		//circle - Input Node
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.arc(44, 208, 4, 0, Math.PI*2, false);
		cvsCtx.stroke();

		//circle - Comp Bypass node
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.arc(44, 233, 4, 0, Math.PI*2, false);
		cvsCtx.stroke();

		//Line comp through 
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(48, 183);
		cvsCtx.lineTo(170, 183);
		cvsCtx.stroke();

		//Line comp bypass
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(48, 233);
		cvsCtx.lineTo(170, 233);
		cvsCtx.stroke();

		//Rect - Comp
		cvsCtx.lineWidth = 1;
		cvsCtx.beginPath();
		cvsCtx.strokeRect(95, 168, 32, 30);

		//vertical line
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(170, 183);
		cvsCtx.lineTo(170, 233);
		cvsCtx.stroke();

		//circle - Node
		cvsCtx.beginPath();
		cvsCtx.arc(170, 208, 4, 0, Math.PI*2, false);
		cvsCtx.fill();

		/* Output section --------------------------------------------------------*/
		//horizontal line
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(170, 208);
		cvsCtx.lineTo(185, 208);
		cvsCtx.stroke();

		//Triangle - output
		cvsCtx.beginPath();
		cvsCtx.moveTo(185, 203);
		cvsCtx.lineTo(195, 208);
		cvsCtx.lineTo(185, 213);
		cvsCtx.fill();
	},
	/*============================================================================
	Drawing Low-Shelf Filter Curve(Filter Index 0 only) for Icon
	============================================================================*/
	drawLowShelf(){
		var cvsCtx = this.cvsFilterFig0.getContext('2d');
		cvsCtx.clearRect(0, 0, this.cvsFilterFig0.width, this.cvsFilterFig0.height);
		cvsCtx.strokeStyle = 'rgb(255, 0, 0)';
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(3, 3);
		cvsCtx.lineTo(9, 3);
		cvsCtx.lineTo(11, 5);
		cvsCtx.lineTo(12, 6);
		cvsCtx.lineTo(17, 17);
		cvsCtx.stroke();
	},
	/*============================================================================
	Drawing High-Shelf Filter Curve(Filter Index 3 only) for Icon
	============================================================================*/
	drawHighShelf(cvs){
		var cvsCtx = this.cvsFilterFig3.getContext('2d');
		cvsCtx.clearRect(0, 0, this.cvsFilterFig3.width, this.cvsFilterFig3.height);
		cvsCtx.strokeStyle = 'rgb(255, 140, 0)';
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(3, 17);
		cvsCtx.lineTo(8, 6);
		cvsCtx.lineTo(9, 5);
		cvsCtx.lineTo(11, 3);
		cvsCtx.lineTo(17, 3);
		cvsCtx.stroke();
	},
	/*============================================================================
	Drawing Peaking Filter Curve for Icon
	============================================================================*/
	drawPeaking(filtIdx){
		var cvs, cvsCtx;
		switch (filtIdx){
			case 0:
				cvs = this.cvsFilterFig0;
				cvsCtx = cvs.getContext('2d');
		    cvsCtx.strokeStyle = 'rgb(255, 0, 0)';
				break;
			case 1:
				cvs = this.cvsFilterFig1;
				cvsCtx = cvs.getContext('2d');
				cvsCtx.strokeStyle = 'rgb(0, 140, 0)';
				break;
			case 2:
				cvs = this.cvsFilterFig2;
				cvsCtx = cvs.getContext('2d');
				cvsCtx.strokeStyle = 'rgb(0, 0, 255)';
				break;
			case 3:
				cvs = this.cvsFilterFig3;
				cvsCtx = cvs.getContext('2d');
				cvsCtx.strokeStyle = 'rgb(255, 140, 0)';
				break;
		}
		cvsCtx.clearRect(0, 0, cvs.width, cvs.height);
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(3, 17);
		cvsCtx.lineTo(5, 17);
		cvsCtx.lineTo(7, 15);
		cvsCtx.lineTo(9, 4);
		cvsCtx.lineTo(10, 3);
		cvsCtx.lineTo(11, 4);
		cvsCtx.lineTo(13, 15);
		cvsCtx.lineTo(15, 17);
		cvsCtx.lineTo(17, 17);
		cvsCtx.stroke();
	},
	/*============================================================================
	Drawing Compressor Curve for Icon
	============================================================================*/
	drawCompCurve(){
		var cvsCtx = this.cvsCompFig.getContext('2d');
		cvsCtx.clearRect(0, 0, this.cvsCompFig.width, this.cvsCompFig.height);
		cvsCtx.strokeStyle = 'black';
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		cvsCtx.moveTo(3, 17);
		cvsCtx.lineTo(10, 8);
		cvsCtx.lineTo(17, 7);
		cvsCtx.stroke();
	},
	/*============================================================================
	Change Filter Type
	============================================================================*/
	chgFilterType: function(filterNo, filterType){
		//console.log(filterNo + ' / ' + filterType);
		switch(filterNo){
			case 0:
				if(filterType === 'lowshelf') this.drawLowShelf();
				else this.drawPeaking(filterNo);
				break;
			case 3:
				if(filterType === 'highshelf') this.drawHighShelf();
				else this.drawPeaking(filterNo);
				break;
		}
	},
	/*============================================================================
	SW Filter
	============================================================================*/
	swFilterToFX: function(idxFilter, isOn){
		if(isOn) $('.cvsFig').eq(idxFilter).css('visibility', 'visible');
		else     $('.cvsFig').eq(idxFilter).css('visibility', 'hidden');
	},
	/*============================================================================
	SW EQ Mode
	============================================================================*/
	swEqModeToFX: function(isOn){
		var cvsCtx = this.cvsRtSwFig.getContext('2d');
		cvsCtx.clearRect(42, 65, 4, 50);	//clear line of nodes between comp through and bypass
		cvsCtx.strokeStyle = 'white';
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		if(isOn){
			cvsCtx.moveTo(44, 69);
			cvsCtx.lineTo(44, 86);
		}else{
			cvsCtx.moveTo(44, 94);
			cvsCtx.lineTo(44, 111);
		}
		cvsCtx.stroke();
	},
	/*============================================================================
	SW Compressor Mode
	============================================================================*/
	swCompModeToFX: function(isOn){
		var cvsCtx = this.cvsRtSwFig.getContext('2d');
		cvsCtx.clearRect(42, 183, 4, 50);	//clear line of nodes between comp through and bypass
		cvsCtx.strokeStyle = 'white';
		cvsCtx.lineWidth = 2;
		cvsCtx.beginPath();
		if(isOn){
			cvsCtx.moveTo(44, 187);
			cvsCtx.lineTo(44, 204);
		}else{
			cvsCtx.moveTo(44, 212);
			cvsCtx.lineTo(44, 229);
		}
		cvsCtx.stroke();
	},
	/*============================================================================
	Set EQ and Comp paramaters to Dialog
	============================================================================*/
	setEqCompParamToDialog: function(eqCompParam){
		var paramEq = eqCompParam.EQ;
		var paramComp = eqCompParam.Comp;
		this.swEqModeToFX(paramEq.isEQ);		//EQ:  SW ON/OFF
		this.swCompModeToFX(paramComp.sw);	//Comp:SW ON/OFF
		paramEq = paramEq.allFilterParams;	//Reset each filters param to same variant
		for(var i=0, len=paramEq.length; i<len; i++){
			this.swFilterToFX(i, paramEq[i].state);
			this.chgFilterType(i, this.filterNames[paramEq[i].type]);
		}
	},

	/*****************************************************************************
	Automation Play
	*****************************************************************************/
	/*============================================================================
	Automation Play: EQ SW
	=============================================================================*/
	playAmEqSwToFX: function(isOn){
		this.swEqModeToFX(isOn);
	},
	/*============================================================================
	Automation Play: Filter SW
	============================================================================*/
	playAmFiltSwToFX: function(idxFilter, isOn){
		this.swFilterToFX(idxFilter, isOn);
	},
	/*============================================================================
	Automation Play: Filter Type
	============================================================================*/
	playAmFiltTypeToFX: function(idxFilter, idxFilterType){
		this.chgFilterType(idxFilter, this.filterNames[idxFilterType]);
	},
	/*============================================================================
	Automation Play: Comp SW
	============================================================================*/
	playAmCompSwToFX: function(isOn){
		this.swCompModeToFX(isOn);
	},
};	//EOF FX



/*******************************************************************************
EQ
*******************************************************************************/
var objEQ = {
	actSrc:  null,	//object source for linkage process(ie. Mixer -> CombProc -> Track, FX and so on) 
	enum_AM: null,	//Automation paramater - index

	/*****************************************************************************
	Navigation
	*****************************************************************************/
	navType: null,

	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Cross Browser
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	isMacFirefox: false,	//true: skip blur() in <select>, false: use blur() in <select>

	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	EQ params
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	//EQ SW ON/OFF
	cvsEqSW:    null,
	colorFxOn : null,	//4 band EQ On
	colorFxOff: null,	//4 band EQ Off
	chkBoxEq:   null,	//each filter

	//Filter Type
	enum_filterType: {	//these values based on WebAudioAPI's biqaud-filter node
		lowShelf:  3,
		highShelf: 4, 
		peaking:   5,
	},

	//filter paramaters
	cvsDragFreq: null,
	cvsDragQ:    null,
	cvsDragGain: null,
	spnEqFreq:   null,	//<span> element for frequency value
	spnEqQ:      null,	//<span> element for Q value
	spnEqGain:   null,	//<span> element for Gain value
	spnEqVal:    null,

	minFreq:  10,		//min Frequency value:    10Hz 
	maxFreq: 20000,	//max Frequency value: 20000Hz 
	minQ:     0.1,	//min Q value: 0.1  
	maxQ:     30,		//max Q value: 30 
	minGain: -30,		//min Gain value: -30dB 
	maxGain:  30,		//max Gain value:  30dB

	//<span> baackground colors for focus 
	colorFocusOn:  null,
	colorFocusOff: null,

	strStartTops: '3px',	//each start Top position of spnEqParams. see CSS definition
	cvsFreqTop: '141px',	//start Top position of cvsDragFreq. see CSS definition
	cvsQTop:    '184px',	//start Top position of cvsDragQ. see CSS definition
	cvsGainTop: '227px',	//start Top position of cvsDragGain. see CSS definition
	

	bufSpnVal: null,	//frequency, Q, Gain of <span> for drag and drop event
	bufDndVal: null,
	dndEvts: [],			//store spnEqParams events 'dragMove' and 'dragEnd'
	eqParamCvs: [],		//store spnEqParams events 'dragMove' and 'dragEnd'


	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	EQ Spectrum
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/* layer 1: EQ grid --------------------------------------------------------*/
	cvsSemiLogEq: null,		//canvas 'semiLogEq'
	widthSemiLogEq: null,	//width of canvas 'semiLogEq'
	heighsemiLogEq: null,	//height of canvas 'semilogEq'
	widthOffsetL:  25,		//left for dB label space
	widthOffsetR:  20,		//right for blank space
	heightOffsetU: 20,		//under	for frequency label space
	heightOffsetT: 10,		//Top for blank space
	widthDrawArea: null,	//'canvas width'  - 'a label space(left)' - 'a blanek space(right)'
	heightDrawArea: null,	//'canvas height' - 'a blank space(top)'  - 'a label space(under)'

	//convert Log(width) and dB(height) to px for graph drawing
	factorLogToPx: null,
	factorDbToPx: null,

	//convert px to log10(width) and dB(height) for biquadFilterNode and EQ knob
	factorPxToLog: null,
	factorPxTodB:  null,

	//semi-log graph label
	fAxisLog:  new Array(),
	fAxisReal: [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000],
	fAxisLbl:  ['10', '50', '100', '200', '500', '1k', '2k', '5k', '10k', '20k'],
	mAxisLbl:  ['-30', '-20', '-10', '0', '10', '20', '30'],


	/* layer 2: EQ spectrum ----------------------------------------------------*/
	cvsEqSpectrum: null,			//canvas 'eqSpectrum'
	widthCvsEqSpectrum: null,	//width of canvas 'eqSpectrum'
	heightCvsEqSpectrum: null,	//width of canvas 'eqSpectrum'
	offsetSpectrumdB: 140,	//offset of spectrum magnitude for visualize
	bufAnalyzerNode: null,	//handle analyser node
	magData: null,					//spectrum data for EQ from bufAnalyzerNode
	datLenSpectrum: null,		//Spectrum data length
	pxFreq: [],							//f axis data for drwaing EQ Spectrum


	/* leyer 3-6:EQ curve ------------------------------------------------------*/
	cvsEqCurves: null,			//canvas 'eqCurve'
	maxFilterGain: 30,			//maximum filter gain

	//eqCurve table
	peakingFp:   10000,
	peakingPxFs: [],
	peakingFs:   [30, 50, 80, 130, 200, 350, 500, 700, 1000, 1400, 2000, 3000, 4000, 5000, 7000, 8000, 9000, 9500, 9900, 10000],
	peakingMags: [0.000613286178134, 0.001701755376712, 0.004345195223089, 0.011394472789224, 0.026563990354481, 0.077210577533696, 0.146084374562442, 0.251792384242815, 0.409101272560884, 0.579591795440124, 0.744518655239424, 0.877784445349796, 0.936140147793464, 0.965422994562597, 0.990934398250372, 0.996336037667268, 0.99913963166698, 0.999789274908656, 0.999991667723992, 0.999999999999999],
	deltaGainShiftPxF: [],
	biasF: [
       0,		//  30Hz
      -9,		//  50HZ
     -27,		//  80Hz
     -63,		// 130Hz
    -102,		// 200Hz
    -171,		// 350Hz
    -216,		// 500Hz
    -240,		// 700Hz
    -156,		//1000Hz
     171,		//1400Hz
     831,		//2000Hz
    1776,		//3000Hz
    2160,		//4000Hz
    2089,		//5000Hz
    1530,		//7000Hz
     960,		//8000Hz
     420,		//9000Hz
     150,		//9500Hz
       3,		//9900Hz 
       0		//10000Hz
	],

	lowShelfFc:   1000,
	lowShelfPxFs: [],
	lowShelfFs:   [100, 200, 300, 400, 500, 600, 700, 800, 1000, 1200, 1400, 1600, 1900, 2300, 3000, 4000, 5000],
	lowShelfMags: [0.999900458809461, 0.99840940352939, 0.991996842967211, 0.975126305936786, 0.94134969196945, 0.885536452852672, 0.806714590764187, 0.709733165238978, 0.500000000000009, 0.324865978268945, 0.205689345752641, 0.131360050702331, 0.070222613642074, 0.033607438464441, 0.011577196546663, 0.003517178332494, 0.001354280114],

	highShelfFc:   1000,
	highShelfPxFs: [],
	highShelfFs:   [300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1500, 2000, 3000, 4000, 5000],
	highShelfMags: [0.008003157032646, 0.024873694063191, 0.058650308030563, 0.11446354714739, 0.193285409235863, 0.290266834760967, 0.395973461804377, 0.499999999999996, 0.675134021731069, 0.836014377349128, 0.942190592691751, 0.988422803453334, 0.996482821667511, 0.998645719886],


	/* layer 7: EQ markers -----------------------------------------------------*/
	//EQ markers event with jQuery plug-in 'draggabilly'
	bufX: null,
	bufY: null,
	eqMrks: new Array(),	//EQ markers Drag & Drop event contents 
	eqColors: [
		"#FF4500",	//OrangeRed
		"#00FF00",	//green
		"#1E90EF",	//blue
		"#FFA500",	//orange
		'#D3D3D3',	//lightgray
	],
	eqLetterColors:[
		"#FF0000",	//Red
		"#00A000",	//Green(org:#008000)
		"#0000FF",	//Blue
		"#FFA500",	//orange
		'#D3D3D3',	//lightgray
	],
	idxDefColor: 4,				//color index for default in Array 'eqColors'
	currMarker: null,			//0:EQ1, 1:EQ2, 2:EQ3, 3:EQ4
	e_filterType: null,		//<select> element 'filterType'


	/*============================================================================
	initialize EQ
	============================================================================*/
	init: function(){
		var actSources = objCombProc.getActSrc();
		this.actSrc = actSources.comp;
		this.enum_AM = objCombProc.getEnumAM();

		/* Navigation ------------------------------------------------------------*/
		this.navType = objNavi.getNavType();

		/* EQ SW ON / OFF --------------------------------------------------------*/
		this.initEqSwitch();

		/* Filter SW ON / OFF ----------------------------------------------------*/
		this.initFilterSwitch();

		/* Filter Type Select ----------------------------------------------------*/
		this.initFilterTypeSelect();

		/* Span: Freq, Q, Gain ---------------------------------------------------*/
		this.initSpanFilterParam();

		/* EQ spectrum -----------------------------------------------------------*/
		this.initSpectrum();
		this.drawEqGrid();
	}, //EOF init


	/*****************************************************************************
	Part Ch. / Master Select
	*****************************************************************************/
	setFilterParamOfCurrChToEQ: function(allEqParam){
		var self = this;
		// var allEqParam = objCombProc.getAllEqParamOfCurrCh();										//get All EQ paramater of current Ch
		this.bufAnalyzerNode = allEqParam.analyserNode;															//change Analyser Node for EQ spectrum
		this.setEqSwColor(allEqParam.isEQ);																					//Set EQ SW on / off
		var params = allEqParam.allFilterParams;																		//All Filter Params
		//console.log(params);
		var isFirstOnFilter = false;
		for(var i=0, len=params.length; i<len; i++){
			$('.chkEq').eq(i).prop('checked', params[i].state);												//A Filter SW ON/OFF
			//Filter SW ON/OFF proc
			if(params[i].state){																											//A filter SW:ON
				//Sets filter paramater for a filter turned on at first 
				if(!isFirstOnFilter){
					isFirstOnFilter = true;																								//found first on EQ
					this.currMarker = i;																									//set current handling marker
					this.setFirstOnFilterParam(params[i].type, params[i].freq, params[i].q, params[i].gain);
					this.setSpnAlignForFilterSW(true);
					this.chgEqCurveZindex();																							//Curr Marker Z-Index Top
				}
				this.setEqMarkerPosFromFreqAndGain(i, params[i].freq, params[i].gain);
				this.makeAndDrawEqCurve(i, params[i].type, params[i].freq, params[i].gain, params[i].q);	//Filter Curve
				$(".draggabilly.eq").eq(i).css('visibility', 'visible');								//marker show
				$(".eqCurve").eq(i).css('visibility', 'visible'); 											//EQ Curve show
			}else{																																		//A filter SW:OFF
				$(".draggabilly.eq").eq(i).css('visibility', 'hidden');									//marker hidden
				$(".eqCurve").eq(i).css('visibility', 'hidden');												//EQ Curve hidden
			}
		}
		if(!isFirstOnFilter) this.setFilterTypeMarkerParamOffMode(true);						//All Markers OFF
	},
	/* ---------------------------------------------------------------------------
	Set First Filter On Mode parameter: filter type, freq, Q and gain
	----------------------------------------------------------------------------*/
	setFirstOnFilterParam: function(idxType, freq, q, gain){
		this.setSelectFilterType(idxType);																					//filter type
		this.setFreqQGainToSpan(freq, q, gain);																			//filter param
		if(idxType === this.enum_filterType.peaking){																//param color
			this.setFilterParamColorToSpan(this.currMarker, this.currMarker);
		}else{
			this.setFilterParamColorToSpan(this.currMarker, this.idxDefColor);
		}
	},
	/*----------------------------------------------------------------------------
	Filter Off Mode 
	----------------------------------------------------------------------------*/
	setFilterTypeMarkerParamOffMode: function(isMarkersOff){
		$("#filterType").prop('disabled', true);																		//Filter type
		if(isMarkersOff) $(".draggabilly.eq").css('visibility', 'hidden');					//Filter marker
		this.setFilterParamColorToSpan(this.idxDefColor, this.idxDefColor);					//<span> Filter param color
		this.setSpnAlignForFilterSW(false);
	},



	/*****************************************************************************
	EQ SW ON / OFF
	*****************************************************************************/
	initEqSwitch: function(){
		var self = this;
		//Draw SW Mark and set background color ------------------------------------
		this.cvsEqSW = document.getElementById('cvsEqSW');
		objCombProc.drawFxSw(this.cvsEqSW);

		//Get color and set Compressor SW
		var colorFxSw = objCombProc.getFxSwColors();
		this.colorFxOn = colorFxSw.on;
		this.colorFxOff = colorFxSw.off;
		this.cvsEqSW.style.backgroundColor = this.colorFxOff;

		//Navigation ---------------------------------------------------------------
		this.cvsEqSW.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.eqSW, e.clientX, e.clientY);
		};
		this.cvsEqSW.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};

		//EVENT: turn ON / OFF compressor ------------------------------------------
		this.cvsEqSW.onmousedown = function(){
			objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.eqSw, true);		//manual operating
		};

		this.cvsEqSW.onclick = function(){
			self.setEqSwColor( objCombProc.switchFxFromEQ() ); 
			objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.eqSw, false);	//end of manual operating
		};
	},
	/*============================================================================
	Set EQ SW color
	============================================================================*/
	setEqSwColor: function(isOn){
		if(isOn) this.cvsEqSW.style.backgroundColor = this.colorFxOn;
		else     this.cvsEqSW.style.backgroundColor = this.colorFxOff;
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation Play: EQ SW
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	playAmEqSwToEQ: function(isOn){
		this.setEqSwColor(isOn);
	},


	/*****************************************************************************
	Filter SW ON / OFF
	*****************************************************************************/
	initFilterSwitch: function(){
		var self = this;

		self.chkBoxEq = document.getElementsByClassName('chkEq');

		//INIT: EQ SW all off ------------------------------------------------------
		$(function($){
			$('.chkEq').prop('checked', false);	//All check is turned off.
		});

		//Navigation ---------------------------------------------------------------
		$(function($){
			//checkbox
			$(".chkEq").mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.eqFiltNo, e.clientX, e.clientY);
			});
			$(".chkEq").mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//label
			$(".lblEqNo").mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.eqFiltNo, e.clientX, e.clientY);
			});
			$(".lblEqNo").mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});
		});

		//EVENT: switch ON / OFF ---------------------------------------------------
		$(function($){
			$(".chkEq").change(function(){
				var filtNo = $('.chkEq').index(this);																		//set current Marker
				self.setIsManOpForFiltSW(filtNo, true);																	//manual operating
				var p = objCombProc.switchFilterFromEQ(filtNo);													//get Filter param for current Marker
				//console.log(p);
				if(p !== null){																													//turn on a filter
					$('.chkEq').eq(filtNo).prop('checked', true);
					self.currMarker = filtNo;
					self.swOnOneFilter(filtNo, p.type, p.freq, p.q, p.gain, true);
				}else{																																	//turn off a filter
					$('.chkEq').eq(filtNo).prop('checked', false);
					self.swOffOneFilter(filtNo, false);
					self.chkOthOnFiltAndSetParam();
				}
				self.setIsManOpForFiltSW(filtNo, false);																//end of manual operating

				this.blur();
			});
		});
	},
	/*----------------------------------------------------------------------------
	Set manual operating for Filter SW
	----------------------------------------------------------------------------*/
	setIsManOpForFiltSW: function(idxFiltNo, isManOp){
		switch(idxFiltNo){
			case 0:
				var idxTypeAM = this.enum_AM.filtSw0;
				break;
			case 1:
				var idxTypeAM = this.enum_AM.filtSw1;
				break;
			case 2:
				var idxTypeAM = this.enum_AM.filtSw2;
				break;
			case 3:
				var idxTypeAM = this.enum_AM.filtSw3;
				break;
		};
		objCombProc.setIsManOp(this.actSrc, null, idxTypeAM, isManOp);
	},
	/*----------------------------------------------------------------------------
	sw on One filter 
	----------------------------------------------------------------------------*/
	swOnOneFilter: function(idxFilter, idxType, freq, q, gain, isCurrMrk){
		if(isCurrMrk){																															//current Marker only proc
			//Filter Type to <select>
			this.setSelectFilterType(idxType);																				//set filter type
			if(idxType === this.enum_filterType.peaking){															//filter type color
				this.setFilterParamColorToSpan(idxFilter, idxFilter);
			}else{
				this.setFilterParamColorToSpan(idxFilter, this.idxDefColor);
			}
			//Freq, Q, Gain to <span>
			this.setFreqQGainToSpan(freq, q, gain);																		//filter param
			this.setSpnAlignForFilterSW(true);																				//text-align
			//Graph
			this.chgEqCurveZindex();																									//Curr Marker Z-Index Top
		}
		//Draw Graph
		this.makeAndDrawEqCurve(idxFilter, idxType, freq, gain, q);									//Filter Curve
		this.setEqMarkerPosFromFreqAndGain(idxFilter, freq, gain);									//Marker

		//Show Marker and Filter Curve
		$(".draggabilly.eq").eq(idxFilter).css('visibility', 'visible');						//marker show
		$(".eqCurve").eq(idxFilter).css('visibility', 'visible'); 									//EQ curve show
	},
	/*----------------------------------------------------------------------------
	sw off One filter 
	----------------------------------------------------------------------------*/
	swOffOneFilter: function(idxFilter){
		$(".draggabilly.eq").eq(idxFilter).css('visibility', 'hidden');							//marker hidden
		$(".eqCurve").eq(idxFilter).css('visibility', 'hidden');										//Filter curve hidden
	},
	/*----------------------------------------------------------------------------
	check other on filter and set to param
	----------------------------------------------------------------------------*/
	chkOthOnFiltAndSetParam: function(){
		var numFilterOff = 0;
		for(var i=0, len=this.chkBoxEq.length; i<len; i++){
			if(this.chkBoxEq[i].checked){																							//checkd filter No.
				this.currMarker = i;
				var param = objCombProc.getFilterParamFromEQ(this.currMarker);					//get Filter param for current Marker
				this.swOnOneFilter(this.currMarker, param.type, param.freq, param.q, param.gain, true);
				break;
			}
			++numFilterOff;
		}
		if(numFilterOff === 4){	//All EQ switched off
			$("#filterType").prop('disabled', true);
			this.setFilterParamColorToSpan(this.idxDefColor, this.idxDefColor);				//font color to <span>
			this.setSpnAlignForFilterSW(false);																				//text and  text-align
			this.currMarker = null;
		}
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation Play: Filter SW ON / OFF
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	playAmFiltSwToEQ: function(filtNo, param){
		if(param !== null){
			$('.chkEq').eq(filtNo).prop('checked', true); 														//A filter turn on
			if(this.currMarker === null){																							//none active marker
				this.currMarker = filtNo;
				this.swOnOneFilter(filtNo, param.type, param.freq, param.q, param.gain, true);
			}else{																																//using one or more filters
				this.swOnOneFilter(filtNo, param.type, param.freq, param.q, param.gain, false);
			}
		}else{
			$('.chkEq').eq(filtNo).prop('checked', false); 														//A filter turn off
			this.swOffOneFilter(filtNo);
			this.chkOthOnFiltAndSetParam();	//check other on filter and set to param
		}
	},



	/*****************************************************************************
	Filter Type Select
	*****************************************************************************/
	initFilterTypeSelect: function(){
		var self = this;

		//set element
		this.e_filterType = document.getElementById('filterType');

		$(function($){
			//INIT -------------------------------------------------------------------
			$("#filterType").prop('disabled', true);		//hidden select

			//Navigation -------------------------------------------------------------
			$("#filterType").mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.eqFiltType, e.clientX, e.clientY);
			});
			$("#filterType").mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			//EVENT ------------------------------------------------------------------
			//focus out for short cut key 'space' on Mac Firefox
			$("#filterType").click('click', function(e){
				if(self.isMacFirefox) e.target.blur();
			});

			$("#filterType").change(function(e){
				//console.log('current Marker no.:' + self.currMarker);
				if(self.currMarker !== null){
					self.setIsManOpForFiltType(true);																			//manual operating

					//Set Filter Type Index 
					var idxFilterType = parseInt(this.value);
					//change filter type
					objCombProc.setFilterTypeFromEQ(self.currMarker, idxFilterType);
					//draw filter curve
					self.makeAndDrawEqCurve(self.currMarker, idxFilterType, parseInt(self.spnEqFreq.innerHTML), parseFloat(self.spnEqGain.innerHTML), parseFloat(self.spnEqQ.innerHTML));	//EQ curve

					//Change font color in <span> as filter type
					if(idxFilterType === self.enum_filterType.peaking){										//peaking
						self.setFilterParamColorToSpan(self.currMarker, self.currMarker);		//font color to <span>
					}else{																																//LowShelf / HighShelf
						self.setFilterParamColorToSpan(self.currMarker, self.idxDefColor);	//font color to <span>
					}

					self.setIsManOpForFiltType(false);																		//end of manual operating
				}
			});
		});
	},
	/*----------------------------------------------------------------------------
	Set manual operating for filter Type
	----------------------------------------------------------------------------*/
	setIsManOpForFiltType: function(isManOp){
		if(this.currMarker === 0)      var idxTypeAM = this.enum_AM.filtType0;			//Filt No.1:LowShelf or Peaking
		else if(this.currMarker === 3) var idxTypeAM = this.enum_AM.filtType3;			//Filt No.3:HighShelf or Peaking

		objCombProc.setIsManOp(this.actSrc, null, idxTypeAM, isManOp);
	},
	/*============================================================================
	Set Filter type
	============================================================================*/
	setSelectFilterType(idxFilterType){
		var self = this;
		$(function($){
			$("#filterType").prop('disabled', false);			//show select

			$("#filterType").val(String(idxFilterType));	//selected value

			//available filter type as each marker 
			switch(self.currMarker){
				case 0:		//Marker No.1
					$('#filterType option[value="3"]').prop('disabled', false);	//LowShelf
					$('#filterType option[value="4"]').prop('disabled', true);	//HighShelf
					$('#filterType option[value="5"]').prop('disabled', false);	//Peaking
					break;
				case 1:		//Marler No.2
				case 2:		//Marker No.3
					$('#filterType option[value="3"]').prop('disabled', true);	//LowShelf
					$('#filterType option[value="4"]').prop('disabled', true);	//HighShelf
					$('#filterType option[value="5"]').prop('disabled', false);	//Peaking
					break;
				case 3:		//Marker No.4
					$('#filterType option[value="3"]').prop('disabled', true);	//LowShelf
					$('#filterType option[value="4"]').prop('disabled', false);	//HighShelf
					$('#filterType option[value="5"]').prop('disabled', false);	//Peaking
					break;
			}
		});
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation Play: Filter Type
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	playAmFiltTypeToEQ: function(filterNo, idxFilterType, param){
		// console.log('filterNo:'+filterNo+' idxFilterType:'+idxFilterType+' @ playAmFiltTypeToEQ of objEQ');

		//Filter Curve
		this.makeAndDrawEqCurve(filterNo, parseInt(param.type), parseInt(param.freq), parseFloat(param.gain).toFixed(1), parseFloat(param.q).toFixed(1));	

		//Set parameter when Assigned Filter index is same as current marker.  
		if(filterNo === this.currMarker){
			//Set Filter Type
			this.setSelectFilterType(idxFilterType);

			//Change font color in <span> as filter type
			if(idxFilterType === this.enum_filterType.peaking){										//peaking
				this.setFilterParamColorToSpan(this.currMarker, this.currMarker);		//font color to <span>
			}else{																																//LowShelf / HighShelf
				this.setFilterParamColorToSpan(this.currMarker, this.idxDefColor);	//font color to <span>
			}
		}
	},

	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Cross Browser
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Set isBlur to EQ
	============================================================================*/
	setIsBlurToEQ: function(){
		this.isMacFirefox = true;
	},


	/*****************************************************************************
	Filter Param in span
	*****************************************************************************/
	initSpanFilterParam: function(){
		/* Span background colors for focus --------------------------------------*/
		var focusColors = objCombProc.getFocusColors();
		this.colorFocusOn = focusColors.on;
		this.colorFocusOff = focusColors.off;

		/* Span: Freq ------------------------------------------------------------*/
		this.spnEqFreq = document.getElementById('spnEqFreq');
		this.cvsDragFreq = document.getElementById('cvsDragFreq');
		this.makeFilterEvt(this.cvsDragFreq, this.spnEqFreq, 'freq', this.cvsFreqTop);

		/* Span: Q ---------------------------------------------------------------*/
		this.spnEqQ = document.getElementById('spnEqQ');
		this.cvsDragQ = document.getElementById('cvsDragQ');
		this.makeFilterEvt(this.cvsDragQ, this.spnEqQ, 'q', this.cvsQTop);

		/* Span: Gain ------------------------------------------------------------*/
		this.spnEqGain = document.getElementById('spnEqGain');
		this.cvsDragGain = document.getElementById('cvsDragGain');
		this.makeFilterEvt(this.cvsDragGain, this.spnEqGain, 'gain', this.cvsGainTop);
	},
	/*============================================================================
	Make Drag and Drop Event for Freq, Q, Gain 
	============================================================================*/
	makeFilterEvt: function(cvs, spn, param, topPos){
		var self = this;
		//EVENT:mouse over / out
		cvs.onmouseover = function(e){
			if(self.bufSpnVal === null) spn.style.backgroundColor = self.colorFocusOn;
			if(isNavi) objNavi.dispMsg(self.navType.eqParam, e.clientX, e.clientY);
		};
		cvs.onmouseout = function(){
			spn.style.backgroundColor = self.colorFocusOff;
			if(isNavi) objNavi.hideMsg();
		};

		//filter value control with jQuery plug-in 'Draggabliiy'
		var dndEvt = new Draggabilly(cvs, {axis:'y'});	//moving direction: vertical 
		//EVENT: mouse click -------------------------------------------------------
		dndEvt.on('pointerDown', function(){
			if(self.currMarker === null) return;
			self.setIsManOpForEqParam(param, true);																		//manual operating
			//self.bufSpnVal = parseInt(spn.innerHTML);
			self.bufSpnVal = parseFloat(spn.innerHTML).toFixed(1);
			self.bufDndVal = null;
		});
		//EVENT:<canvas> draggin ---------------------------------------------------
		dndEvt.on('dragMove', function(event, pointer, moveVector){
			if(self.currMarker === null) return;
			spn.style.backgroundColor = self.colorFocusOn;
			self.chkAndUpdateParam(param, self.bufSpnVal, moveVector.y);
		});
		//EVENT:<canvas> drag end --------------------------------------------------
		dndEvt.on('dragEnd', function(event){
			this.element.style.top = topPos;		//Reset top position 
			self.bufSpnVal = null;
			spn.style.backgroundColor = self.colorFocusOff;
			self.bufDndVal = null;
		});
		//EVENT: after clicked mouse -----------------------------------------------
		dndEvt.on('pointerUp', function(event){
			if(self.currMarker === null) return;
			self.setIsManOpForEqParam(param, false);																	//end of operating
		});
		self.dndEvts.push(dndEvt);	//each <canvas>'s events set to array.
	},
	/*----------------------------------------------------------------------------
	Set manual operating for each EQ parameter
	----------------------------------------------------------------------------*/
	setIsManOpForEqParam: function(param, isManOp){
		switch(param){
			case 'freq':
				if(this.currMarker === 0)      var idxTypeAM = this.enum_AM.filtFreq0;
				else if(this.currMarker === 1) var idxTypeAM = this.enum_AM.filtFreq1;
				else if(this.currMarker === 2) var idxTypeAM = this.enum_AM.filtFreq2;
				else if(this.currMarker === 3) var idxTypeAM = this.enum_AM.filtFreq3;
				break;
			case 'q':
				if(this.currMarker === 0)      var idxTypeAM = this.enum_AM.filtQ0;
				else if(this.currMarker === 1) var idxTypeAM = this.enum_AM.filtQ1;
				else if(this.currMarker === 2) var idxTypeAM = this.enum_AM.filtQ2;
				else if(this.currMarker === 3) var idxTypeAM = this.enum_AM.filtQ3;
				break;
			case 'gain':
				if(this.currMarker === 0)      var idxTypeAM = this.enum_AM.filtGain0;
				else if(this.currMarker === 1) var idxTypeAM = this.enum_AM.filtGain1;
				else if(this.currMarker === 2) var idxTypeAM = this.enum_AM.filtGain2;
				else if(this.currMarker === 3) var idxTypeAM = this.enum_AM.filtGain3;
				break;
		};
		objCombProc.setIsManOp(this.actSrc, null, idxTypeAM, isManOp);
	},
	/*----------------------------------------------------------------------------
	Check and Update paramater
	----------------------------------------------------------------------------*/
	chkAndUpdateParam: function(param, baseVal, delta){
		var updateVal;
		switch(param){
			case 'freq':
				updateVal = baseVal - delta;																						//1px - 1Hz
				if(updateVal > this.maxFreq)      updateVal = this.maxFreq;
				else if(updateVal < this.minFreq) updateVal = this.minFreq;
				if(this.bufDndVal === updateVal) return;																//check same value for min/max
				else this.bufDndVal = updateVal;
				this.setFreqToSpan(updateVal);																					//<span>
				this.setEqMarkerPosFromFreq(this.currMarker, updateVal);								//Marker
				this.makeAndDrawEqCurve(this.currMarker, parseInt(this.e_filterType.value), updateVal, parseFloat(this.spnEqGain.innerHTML).toFixed(1), parseFloat(this.spnEqQ.innerHTML).toFixed(1));	//EQ curve
				this.setFilterNodeFreq(updateVal);																			//WebAudioAPI
				break;
			case 'q':
				updateVal = baseVal - delta / 10;																				//1px = 0.1
				if(updateVal > this.maxQ)      updateVal = this.maxQ;
				else if(updateVal < this.minQ) updateVal = this.minQ;
				updateVal = parseFloat(updateVal).toFixed(1);
				if(this.bufDndVal === updateVal) return;																//check same value for min/max
				else this.bufDndVal = updateVal;
				this.setQToSpan(updateVal);																							//<span>
				this.makeAndDrawEqCurve(this.currMarker, parseInt(this.e_filterType.value), parseFloat(this.spnEqFreq.innerHTML).toFixed(1), parseFloat(this.spnEqGain.innerHTML).toFixed(1), updateVal);	//EQ curve
				this.setFilterNodeQ(updateVal);																					//WebAudioAPI
				break;
			case 'gain':
				updateVal = baseVal - delta / 10;																				//1px = 0.1dB
				if(updateVal > this.maxGain)      updateVal = this.maxGain;
				else if(updateVal < this.minGain) updateVal = this.minGain;
				updateVal = parseFloat(updateVal).toFixed(1);
				if(this.bufDndVal === updateVal) return;																//check same value for min/max
				else this.bufDndVal = updateVal;
				this.setGainToSpan(updateVal);																					//<span>
				this.setEqMarkerPosFromGain(this.currMarker, updateVal);								//Marker
				this.makeAndDrawEqCurve(this.currMarker, parseInt(this.e_filterType.value), parseFloat(this.spnEqFreq.innerHTML).toFixed(1), updateVal, parseFloat(this.spnEqQ.innerHTML).toFixed(1));	//EQ curve
				this.setFilterNodeGain(updateVal);																			//WebAudioAPI
				break;
		}
	},
	/*============================================================================
	Set Frequency, Q, Gain value to <span>
	============================================================================*/
	setFreqQGainToSpan: function(freq, q, gain){
		this.setFreqToSpan(freq);
		if(q !== null) this.setQToSpan(q);
		this.setGainToSpan(gain);
	},
	/*============================================================================
	Set Frequency value to <span>
	============================================================================*/
	setFreqToSpan: function(freq){
		$('#spnEqFreq').text( String(Math.round(freq)) );
	},
	/*============================================================================
	Set Q value to <span>
	============================================================================*/
	setQToSpan: function(q){
		$('#spnEqQ').text(String(parseFloat(q).toFixed(1)));
	},
	/*============================================================================
	Set Gain value to <span>
	============================================================================*/
	setGainToSpan: function(gain){
		$('#spnEqGain').text(String(parseFloat(gain).toFixed(1)));
	},
	/*============================================================================
	Set <span> color
	============================================================================*/
	setFilterParamColorToSpan: function(idxColorFreqAndGain, idxColorQ){
			//console.log('idxColorFreqAndGain:' + idxColorFreqAndGain + ' idxColorQ:' + idxColorQ);
			$('#spnEqFreq').css('color', this.eqLetterColors[idxColorFreqAndGain]);
			$('#spnEqQ').css('color', this.eqLetterColors[idxColorQ]);
			$('#spnEqGain').css('color', this.eqLetterColors[idxColorFreqAndGain]);
	},
	/*============================================================================
	Set <span> alignment for Filter SW
	============================================================================*/
	setSpnAlignForFilterSW(isFilterSwON){
		if(isFilterSwON){
			$('#spnEqFreq').css('text-align', 'right');
			$('#spnEqQ').css('text-align', 'right');
			$('#spnEqGain').css('text-align', 'right');
		}else{
			$('#spnEqFreq').css('text-align', 'center');
			$('#spnEqQ').css('text-align', 'center');
			$('#spnEqGain').css('text-align', 'center');
			$('#spnEqFreq').html ('-----');
			$('#spnEqQ').html('---');
			$('#spnEqGain').html('---');
		}
	},


	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation Play: Freq, Q, Gain
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	playAmFiltParamToEQ: function(filterNo, param, tgtParam){
		//<span>
		if(filterNo === this.currMarker){
			if(tgtParam === 'freq')      this.setFreqToSpan(param.freq);
			else if(tgtParam === 'q')    this.setQToSpan(param.q);
			else if(tgtParam === 'gain') this.setGainToSpan(param.gain);
		}
		//Marker
		if(tgtParam === 'freq')	     this.setEqMarkerPosFromFreq(filterNo, param.freq);
		else if(tgtParam === 'gain') this.setEqMarkerPosFromGain(filterNo, param.gain);
		//Filter Curve
		this.makeAndDrawEqCurve(filterNo, parseInt(param.type), parseInt(param.freq), parseFloat(param.gain).toFixed(1), parseFloat(param.q).toFixed(1));	
	},


	/*****************************************************************************
	Set Filter Parameter to Web Audio API filter node
	*****************************************************************************/
	/*============================================================================
	 WebAudioAPI: biquadNodeFilter's frequency change
	 ===========================================================================*/
	setFilterNodeFreq: function(freq){
		objCombProc.setFreqFromEQ(this.currMarker, freq);
	},

	/*============================================================================
	WebAudioAPI: biquadNodeFilter's Q change
	============================================================================*/
	setFilterNodeQ: function(q){
		objCombProc.setQFromEQ(this.currMarker, q);
	},

	/*============================================================================
	WebAudioAPI: biquadNodeFilter's gain change
	============================================================================*/
	setFilterNodeGain: function(gain){
		objCombProc.setGainFromEQ(this.currMarker, gain);
	},


	/*****************************************************************************
	EQ spectrum
	*****************************************************************************/
	initSpectrum: function(){
		var self = this;

		//layer 1: EQ grid ---------------------------------------------------------
		//drawing x-axis as freuency
		self.cvsSemiLogEq = document.getElementById('semiLogEq');

		//drawing area for spectrum
		self.widthSemiLogEq  = self.cvsSemiLogEq.width;
		self.heightSemiLogEq = self.cvsSemiLogEq.height;
		self.widthDrawArea = self.widthSemiLogEq  - self.widthOffsetL - self.widthOffsetR;
		self.heightDrawArea = self.heightSemiLogEq - self.heightOffsetU - self.heightOffsetT;

		//convert to Log(width) or dB(height) to px
		self.factorLogToPx = self.widthDrawArea / (Math.log10(20000) - 1);					//'1' of den is log value of 10Hz
		self.factorDbToPx = self.heightDrawArea / (self.mAxisLbl.length -1);				//den is line number

		//convert px to log10(width) and dB(height) for biquadFilterNode and EQ knob
		self.factorPxToLog = (Math.log10(20000) - 1) / self.widthDrawArea;
		self.factorPxTodB = 60 / self.heightDrawArea;																//60 is the range -30dB to 30dB.

		//log10 value for frequency
		for(var i=0, len=self.fAxisReal.length; i<len; i++){
			self.fAxisLog.push(Math.log10(self.fAxisReal[i]));	//freq convert to log10
		}


		//layer 2: EQ spectrum -----------------------------------------------------
		self.cvsEqSpectrum = document.getElementById('eqSpectrum');
		self.widthCvsEqSpectrum = self.cvsEqSpectrum.width;
		self.heightCvsEqSpectrum = self.cvsEqSpectrum.height;


		//get analyzer node for EQ spectrum and set magnitute data size
		self.bufAnalyzerNode = objCombProc.getAnalyzerNode();
		self.magData = new Float32Array(self.bufAnalyzerNode.frequencyBinCount);
		//set logged Frequency in px for drawing spectrum more faseter
		self.datLenSpectrum = self.bufAnalyzerNode.frequencyBinCount;								//half of FFT points
		var deltaF = context.sampleRate / self.bufAnalyzerNode.fftSize;
		for(var i=0; i < self.datLenSpectrum; ++i) {
			self.pxFreq.push( (Math.log10(i * deltaF) - 1) * self.factorLogToPx );
		}


		//leyer 3-6:EQ curve -------------------------------------------------------
		self.cvsEqCurves = document.getElementsByClassName('eqCurve');
		// convert to filter curve from liner to Px
		self.deltaGainShiftPxF = self.convertNormalizdGainShiftPxF();																	//freq shift as gain for peaking
		self.peakingPxFs = self.convertNormalizdFilterCurvePxFs(self.peakingFp, self.peakingFs);			//peaking filter
		self.lowShelfPxFs = self.convertNormalizdFilterCurvePxFs(self.lowShelfFc, self.lowShelfFs);		//low-shelf filter
		self.highShelfPxFs = self.convertNormalizdFilterCurvePxFs(self.highShelfFc, self.highShelfFs);//high-shelf filter


		//layer 7: EQ markers ------------------------------------------------------
		$(function($){
			//INIT: EQ markers hidden-------------------------------------------------
			$('.draggabilly.eq').css('visibility','hidden');

			//Navigation -------------------------------------------------------------
			$('.draggabilly.eq').mousemove(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.eqMarker, e.clientX, e.clientY);
			});
			$('.draggabilly.eq').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});
		});

		//Assigned markers to jQuery plug-in 'draggabiliy' and Set events
		self.eventEqMarkers();
	}, //EOF initSpectrum

	/*----------------------------------------------------------------------------
	layer3-6: Normalized Frequency shift as gain for peaking in px  
	----------------------------------------------------------------------------*/
	convertNormalizdGainShiftPxF: function(){
		//Shifted frequency @ gain 30dB
		var gainShiftF = [];
		for(var i=0, len=this.biasF.length; i<len; i++){
			gainShiftF.push( this.peakingFs[i] + this.biasF[i] );
		}
		//Convert liner -> log10 -> px and normalized(subtraction peak frequency and divided maximum filter gain)
		var pxFp = (Math.log10(this.peakingFp) - 1) * this.factorLogToPx;	//peak frequency in px
		var gainShiftPxF = [];
		for(var i=0, len=gainShiftF.length; i<len; i++){
			gainShiftPxF.push( ((Math.log10(gainShiftF[i]) - 1) * this.factorLogToPx - pxFp) / this.maxFilterGain);
		}
		return gainShiftPxF;
	},

	/*----------------------------------------------------------------------------
	layer 3-6: Normalized EQ curve in px
	----------------------------------------------------------------------------*/
	convertNormalizdFilterCurvePxFs: function(fc, curvDat){
		var pxCurve = [];
		//convert linear->log10->px
		var pxFc = (Math.log10(fc) - 1) * this.factorLogToPx;												//cut off frequency
		for(var i=0, len=curvDat.length; i<len; i++){
			pxCurve.push( (Math.log10(curvDat[i]) - 1) * this.factorLogToPx - pxFc );	//curve data
		}
		return pxCurve;
	},

	/*----------------------------------------------------------------------------
	layer 7: Event for EQ markers
	----------------------------------------------------------------------------*/
	eventEqMarkers: function(){
		var self = this;
		//layer 7: marker control with jQuery plug-in 'Draggabliiy'
		var eqMrkElems = document.querySelectorAll('.draggabilly.eq');
		//console.log(eqMrkElems);
		for(var i=0, len = eqMrkElems.length; i<len; i++){
			var eqMrkElem = eqMrkElems[i];
			var eqMrk = new Draggabilly(eqMrkElem, {containment: '#markerArea'});

			//Event: mouse click -----------------------------------------------------
			eqMrk.on('pointerDown', function(){
				self.bufX = self.bufY = null;
				//get marker's ID
				var markerIdx = parseInt( (this.element.id).replace(/eqMarker/g, '') );
				self.setIsManOpForEqMarker(markerIdx, true);												//manual operating

				if(self.currMarker === markerIdx) return; //skip under proc in the case of same marker 
				//set eq param to <span>
				self.currMarker = markerIdx;																						//update current handling Marker
				var param = objCombProc.getFilterParamFromEQ(self.currMarker);					//A filter param for current Marker
				self.setSelectFilterType(param.type);																		//Filter Type 
				self.setFreqQGainToSpan(param.freq, param.q, param.gain);								//Filter param
				//Set Filter Param color
				if(param.type === self.enum_filterType.peaking){
					self.setFilterParamColorToSpan(self.currMarker, self.currMarker);
				}else{
					self.setFilterParamColorToSpan(self.currMarker, self.idxDefColor);
				}
				self.chgEqCurveZindex();																								//Curr Marker Z-Index Top
			});
			//Event: marker draggin --------------------------------------------------
			eqMrk.on('dragMove', function(){
				//these px valus are already adapted to frequency & dB.
				var x = this.dragPoint.x + this.relativeStartPosition.x;
				var y = this.dragPoint.y + this.relativeStartPosition.y;
				//console.log('mov X:' + x + ' mov Y:' + y);
				if(self.bufX === x && self.bufY === y){																	//check same value
					return;
				}else{
					self.bufX = x;
					self.bufY = y;
				}

				//convert px to frequency or dB
				var pxf = x * self.factorPxToLog + 1;	//'1' is offset for the log10 value of 10Hz.
				pxf = Math.pow(10, pxf);							//change log to anti-log
				var pxdB = (self.heightDrawArea - y) * self.factorPxTodB - self.maxFilterGain; //Inverted the y value and offset -30dB
				pxdB = (Math.floor(pxdB * 10)) / 10;	//calculate to one decimal place.
				//console.log('f:' + pxf + ' dB:' + pxdB);
				self.setFilterNodeFreq(pxf);									//set the frequency value of biquadFilterNode
				self.setFilterNodeGain(pxdB)									//set the Node value of biquadFilterNode
				self.setFreqQGainToSpan(pxf, null, pxdB, false);
				self.makeAndDrawEqCurve(self.currMarker, parseInt(self.e_filterType.value), pxf, pxdB, parseFloat(self.spnEqQ.innerHTML).toFixed(1));	//EQ curve
			});
			//Event: marker drag end -------------------------------------------------
			eqMrk.on('dragEnd', function(){
				self.bufX = self.bufY = null;
				//console.log('dragEnd');
			});
			//Event: after clicked mouse ---------------------------------------------
			eqMrk.on('pointerUp', function(){
				self.setIsManOpForEqMarker(self.currMarker, false);									//end of manual operating
			});
			self.eqMrks.push(eqMrk);	//each markers set to array
		}
	},
	/*----------------------------------------------------------------------------
	Set manual operating for EQ marker
	----------------------------------------------------------------------------*/
	setIsManOpForEqMarker: function(idxFiltNo, isManOp){
		//console.log('idxFiltNo:' + idxFiltNo);
		switch(idxFiltNo){
			case 0:
				var idxTypeAmFreq = this.enum_AM.filtFreq0;
				var idxTypeAmGain = this.enum_AM.filtGain0;
				break;
			case 1:
				var idxTypeAmFreq = this.enum_AM.filtFreq1;
				var idxTypeAmGain = this.enum_AM.filtGain1;
				break;
			case 2:
				var idxTypeAmFreq = this.enum_AM.filtFreq2;
				var idxTypeAmGain = this.enum_AM.filtGain2;
				break;
			case 3:
				var idxTypeAmFreq = this.enum_AM.filtFreq3;
				var idxTypeAmGain = this.enum_AM.filtGain3;
				break;
		};
		objCombProc.setIsManOp(this.actSrc, null, idxTypeAmFreq, isManOp);	//Frequency
		objCombProc.setIsManOp(this.actSrc, null, idxTypeAmGain, isManOp);	//Gain
	},
	/*============================================================================
	drawing label and grid(layer 1)
	============================================================================*/
	drawEqGrid: function(){
		var self = this;
		//layer 1: drawing semilog graph with label
		
		//drawing x-axis as frequency(log10)
		var cvsSemiLogEq = self.cvsSemiLogEq;
		var ctxSemiLogEq = cvsSemiLogEq.getContext('2d');
		ctxSemiLogEq.clearRect(0, 0, cvsSemiLogEq.width, cvsSemiLogEq.height);
		ctxSemiLogEq.fillStyle = 'rgb(0, 0, 0)';
		ctxSemiLogEq.fillRect(0, 0, cvsSemiLogEq.width, cvsSemiLogEq.height);

		//the frequecy range(10Hz - 20kHz) adapts to graph width(px).
		//Notice!: the logged value of 10[Hz] is '1'. But, a graph uses the value '0'.
		//Then, '-1' is used to adapt for draiwng a graph.
		ctxSemiLogEq.fillStyle = 'rgb(168, 168, 168)';
		var x;
		for(var i=0, len=self.fAxisLog.length; i<len; i++){
			x = (self.fAxisLog[i] - 1) * self.factorLogToPx + self.widthOffsetL; //line & label positon(px)
			//console.log(x);
			ctxSemiLogEq.fillRect(x, self.heightOffsetT, 1, self.heightDrawArea);	//line
			ctxSemiLogEq.fillText(self.fAxisLbl[i], x-5, cvsSemiLogEq.height-5);	//label
		}

		//drawing y-axis as dB
		//pxdB = (cvsSemiLogEq.height - heightOffsetT - heightOffsetU) / (mAxisLbl.length-1);
		var y;
		for(var i=0, len = self.mAxisLbl.length; i<len; i++){
			y =  cvsSemiLogEq.height - self.heightOffsetU - i * self.factorDbToPx;
			//console.log(y);
			ctxSemiLogEq.fillRect(self.widthOffsetL, y, self.widthDrawArea, 1);
			ctxSemiLogEq.fillText(self.mAxisLbl[i], 5, y+5);
		}
	},


	/*============================================================================
	drawing EQ spectrum(layer 2) 
	============================================================================*/
	darwEqSpectrum: function(){
		var self = this;
		//layer 2: draw spectrum
		var ctxEqSpectrum = self.cvsEqSpectrum.getContext('2d');
		ctxEqSpectrum.clearRect(0, 0, self.cvsEqSpectrum.width, self.cvsEqSpectrum.height);
		ctxEqSpectrum.fillStyle = "#009900";

		self.bufAnalyzerNode.getFloatFrequencyData(self.magData);
		var i;
		for(var i = 1; i < self.datLenSpectrum; ++i) {	//i=0 is DC. Then, start number is 1.
			y = (self.magData[i] + self.offsetSpectrumdB);
			ctxEqSpectrum.fillRect(self.pxFreq[i], self.cvsEqSpectrum.height - y, 2 , y);
		}
	},

	/*============================================================================
	Make and Draw EQ curve(layer 3 - 6)
	============================================================================*/
	makeAndDrawEqCurve: function(idxMarker, idxFilterType, fc, gain, q){
		//console.log(idxFilterType);
		var curveDat = this.makeEqCurve(idxFilterType, fc, gain, q);						//fileter curve data
		this.drawEqCurve(idxMarker, curveDat);																	//draw filter curve
	},

	/*----------------------------------------------------------------------------
	Make EQ Curve(layer 3 - 6)
	----------------------------------------------------------------------------*/
	makeEqCurve: function(filterType, fc, gain, Q){
		if(Q === 0) Q = 0.1;
		Q = Math.floor(Q * 10) / 10;	//one decimal
		var pxFs = [];
		var mags = [];
		var pxFc = (Math.log10(fc) - 1) * this.factorLogToPx;
		switch(filterType){
			case this.enum_filterType.peaking: //peaking
				var xOffset = 0; //adjust spectrum graph grid for drawing 
				var pxFsGain, pxFsGainQ, leftPxFsGainQ=[], rightPxFsGainQ=[], mag, leftMag=[], rightMag=[];
				for(var i=0, len=this.peakingPxFs.length; i<len; i++){
					pxFsGain = (this.peakingPxFs[i] + this.deltaGainShiftPxF[i] * Math.abs(gain)); //frequency shift as gain
					pxFsGainQ = pxFsGain * 0.1 / Q + 0.01;																//frequency shift as Q
					mag = this.peakingMags[i] * gain;																			//gain as magnitude
					if(i < len-1){
						//frequency in px
						leftPxFsGainQ.push(pxFc + pxFsGainQ + xOffset);
						rightPxFsGainQ.unshift(pxFc - pxFsGainQ + xOffset) ;
						//magnitute
						leftMag.push(mag);
						rightMag.unshift(mag);
					}else{																																//center frequency
						leftPxFsGainQ.push(pxFc + xOffset);																	//frequency in px
						leftMag.push(mag);
					}
				}
				pxFs = leftPxFsGainQ.concat(rightPxFsGainQ);														//frequency in px
				mags = leftMag.concat(rightMag);																				//magnitude
				//Add 0 for narrow spectrum curve 
				if( pxFs[0] > 0 ){																											//left side
					pxFs.unshift(0);
					mags.unshift(0);
				}
				if( pxFs[pxFs.length-1] < this.widthDrawArea){													//right side
					pxFs.push(this.widthDrawArea);
					mags.push(0);
				}
				break;
			case this.enum_filterType.highShelf: //HighShelf
				for(var i=0, len=this.highShelfFs.length; i<len; i++){
					pxFs.push( this.highShelfPxFs[i] + pxFc );	//frequency in px
					mags.push( this.highShelfMags[i] * gain );	//magnitude
				}
				//Add 0 or gain the edge of high shelf spectrum
				if(pxFs[0] > 0){																												//left side
					pxFs.unshift(0);
					mags.unshift(0);
				}
				if( pxFs[pxFs.length-1] < this.widthDrawArea){													//right side
					pxFs.push(this.widthDrawArea);
					mags.push(mags[mags.length-1]);
				}
				break;
			case this.enum_filterType.lowShelf: //LowShelf
				for(var i=0, len=this.lowShelfFs.length; i<len; i++){
					pxFs.push( this.lowShelfPxFs[i] + pxFc );	//frequency in px
					mags.push( this.lowShelfMags[i] * gain );	//magnitude
				}
				if(pxFs[0] > 0){																												//left side
					pxFs.unshift(0);
					mags.unshift(mags[0]);
				}
				if( pxFs[pxFs.length-1] < this.widthDrawArea){													//right side
					pxFs.push(this.widthDrawArea);
					mags.push(0);
				}
				break;
		}
		return {
			freq: pxFs,	//frequency
			mag: mags,	//magnitude
		};
	},

	/*----------------------------------------------------------------------------
	drwaing EQ curve(layer 3 - 6)
	----------------------------------------------------------------------------*/
	drawEqCurve: function(idxMarker, datCurve){
		var ctxEqCurve = this.cvsEqCurves[idxMarker].getContext('2d');
		ctxEqCurve.clearRect(0, 0, this.cvsEqCurves[idxMarker].width, this.cvsEqCurves[idxMarker].height);
		ctxEqCurve.strokeStyle = this.eqColors[idxMarker];
		ctxEqCurve.beginPath();
		// var offsetLeftPx = 0.5;	//half value for graph grid line because width is 1px 
		var offsetLeftPx = 0.7; 
		var isOver0 = false;
		for(var i=0, len=datCurve.freq.length; i<len; i++){
			if(datCurve.freq[i] < -ctxEqCurve.width / 8) continue;
			if(datCurve.freq[i] > ctxEqCurve.width) return;
			if(isOver0 = false){
				ctxEqCurve.moveTo(datCurve.freq[i] + offsetLeftPx, this.cvsEqCurves[idxMarker].height / 2 - datCurve.mag[i] * this.cvsEqCurves[idxMarker].height / 60);
				isOver0 = true;
			}else{
				ctxEqCurve.lineTo(datCurve.freq[i] + offsetLeftPx, this.cvsEqCurves[idxMarker].height / 2 - datCurve.mag[i] * this.cvsEqCurves[idxMarker].height / 60);
			}
		}
		ctxEqCurve.stroke();
	},

	/*============================================================================
	Change EQ Curve Z-Index(layer 3 - 6)
	============================================================================*/
	chgEqCurveZindex: function(){
	var bufZidx = this.cvsEqCurves[this.currMarker].style.zIndex;
	if(bufZidx === '3'){																													//the forth layer
		for(var i=0, len=this.cvsEqCurves.length; i<len; i++){
			if(this.cvsEqCurves[i].style.zIndex !== '3')															//other layiers minus 1
				this.cvsEqCurves[i].style.zIndex = String(parseInt(this.cvsEqCurves[i].style.zIndex) - 1);
		}
	}else if(bufZidx === '4'){
		for(var i=0, len=this.cvsEqCurves.length; i<len; i++){											//the second layer
			if(this.cvsEqCurves[i].style.zIndex === '5' || this.cvsEqCurves[i].style.zIndex === '6')
				this.cvsEqCurves[i].style.zIndex = String(parseInt(this.cvsEqCurves[i].style.zIndex) - 1);
		}
	}else if(bufZidx === '5'){																										//the third layer
		for(var i=0, len=this.cvsEqCurves.length; i<len; i++){
			if(this.cvsEqCurves[i].style.zIndex === '6')
				this.cvsEqCurves[i].style.zIndex = String(parseInt(this.cvsEqCurves[i].style.zIndex) - 1);
		}
	}
	this.cvsEqCurves[this.currMarker].style.zIndex = '6';
	},

	/*============================================================================
	Set EQ Marker Position from frequency and Gain (layer 7)
	============================================================================*/
	setEqMarkerPosFromFreqAndGain: function(idxMarker, freq, gain){
		this.setEqMarkerPosFromFreq(idxMarker, freq);
		this.setEqMarkerPosFromGain(idxMarker, gain);
	},

	/*============================================================================
	Set EQ Marker Position from frequency (layer 7)

	Note! width by jQuery(e.g. $('#eqSpectrum').width() ) sometimes sets 0.
				because width can't calculation quickly by jQuery then pxFreq doesn't work well.
	============================================================================*/
	setEqMarkerPosFromFreq: function(idxMarker, freq){
		var pxFreq = (Math.log10(freq) - 1) / (Math.log10(20000)-1) * this.widthCvsEqSpectrum + 19.5;//19.5;
		$('.draggabilly.eq').eq(idxMarker).css("left", pxFreq);
	},

	/*============================================================================
	Set EQ Marker Position from gain (layer 7)
	============================================================================*/
	setEqMarkerPosFromGain: function(idxMarker, gain){
		var pxdB = Math.floor((1/2 - gain / 60) * this.heightCvsEqSpectrum + 5);
		//console.log(pxdB);
		$('.draggabilly.eq').eq(idxMarker).css("top", pxdB);
	},
}; //EOF objEQ


/*******************************************************************************
Comp
*******************************************************************************/
var objComp = {
	/* Navigation --------------------------------------------------------------*/
	navType: null,

	/* parameter ---------------------------------------------------------------*/
	actSrc:      null, //object source for linkage process(ie. Mixer -> CombProc -> Track, FX and so on) 
	enum_AM:     null,	//Automation param - index
	isCompSwON:  false, //true: SW ON, false: SW OFF 
	//Web Audio API
	bufDynCompNode: null,	//for Reduction(Read Only Usage!)

	//color of Compressor SW ON / OFF
	colorSwOn:  null,
	colorSwOff: null,

	//<span> elements
	spnThreshold: null,
	spnKnee:      null,
	spnAttack:    null,
	spnRelease:   null,
	spnReduction: null, 

	//<canvas> elements
	cvsCompSW:    null,
	cvsThreshold: null, //for drag & drop
	cvsKnee:      null,
	cvsRatio:     null,
	cvsAttack:    null,
	cvsRelease:   null,

	//start <canvas> position for drag & drop - see css definition
	cvsThresholdTop: '40px',
	cvsKneeTop:      '65px',
	cvsAttackTop:    '175px',
	cvsReleaseTop:   '200px',

	//each parameter min/max
	minThreshold: -60,
	maxThreshold: 0, 
	minKnee: 0,
	maxKnee: 30, 
	minRatio: 1,
	maxRatio: 8,
	minAttack: 0,
	maxAttack: 1.0,
	minRelease: 0,
	maxRelease: 1.0,

	//<canvas >Drag and Drop event with draggabilly 
	dndEvts: [],
	bufSpnVal: null,			//buffer span value for each regParamEvt
	bufDndVal: null,
	colorFocusOn:  null,
	colorFocusOff: null,


	/* Graph layer 0: Threshold marker area ------------------------------------*/
	cvsThresholdMrkArea: null,

	/* Graph layer 1: grid and label -------------------------------------------*/
	cvsCompGraph: null,
	mindB: -60,
	maxdB: 0,
	rangedB: null,
	offsetLeft:   27,			//label space for vertical
	offsetRight:  13,			//blank
	offsetTop:    18,			//blank 
	offsetBottom: 22, 		//label space for horizontal
	widthDrawArea:  null,	//for grid 
	heightDrawArea: null,	//for grid

	/* Graph layer 2: curve from threshold to ratio ----------------------------*/
	cvsCompCurve: null,

	//ratio 1:2 then these values x 4, ratio 1:4 then these values are x 2.
	norm_knee_curve: [
		0,		//0 - threshold curve end point
		0.20,	//1
		0.33,	//2
		0.45,	//3
		0.58,	//4
		0.69,	//5
		0.81,	//6
		0.92,	//7
		1.03,	//8
		1.14,	//9
		1.25,	//10 - ratio(1:8) curve start point
	],

	/* layer 3: Threshold ------------------------------------------------------*/
	spnThresholdMarker: null,
	evtCompMarker: [],				//Marker Event as Threshold and Ratio
	bufY: null,								//check for same value or not in drag & drop event of comp graph 

	/* Bar graph of Reduction --------------------------------------------------*/
	cvsCompReductGraph: null,
	cvsCompReduction:   null,



	/*============================================================================
	initialize Comp
	============================================================================*/
	init: function(){
		var actSources = objCombProc.getActSrc();
		this.actSrc = actSources.comp;
		this.enum_AM = objCombProc.getEnumAM(); //Automation param - index

		/* Navigation ------------------------------------------------------------*/
		this.navType = objNavi.getNavType();

		/* Compressor SW ---------------------------------------------------------*/
		this.initCompSW();

		/* Compressor Param in span ----------------------------------------------*/
		this.initSpanCompParam();

		/* Ratio -----------------------------------------------------------------*/
		this.initRatio();

		/* Compressore curve -----------------------------------------------------*/
		this.initCompCurve();
		
		/* Reduction -------------------------------------------------------------*/
		this.initReduction();

		/* Set initial Paramater ---------------------------------------------------
		 Notice! 
			this function doesn't need the assignment compressor parameters and draw graph.
			Because objFX's initialise call these processes.
		--------------------------------------------------------------------------*/
		// var allCompParam = objCombProc.getCompAllParams();
		// this.setParamOfCurrChToComp(allCompParam);
	},


	/*****************************************************************************
	Parametars
	*****************************************************************************/
	setParamOfCurrChToComp: function(params){
		// var params = objCombProc.getCompAllParams();
		
		//Set dynCompNode for reduction(Read Only Usage!)
		this.bufDynCompNode = params.dynCompNode;

		//Set each params
		this.setCompSwColor(params.sw);
		this.setThresholdToSpn(params.threshold);
		this.setThresholdMarkerPos(params.threshold);
		this.setKneeToSpn(params.knee);
		this.setRatioToRadioBtn(params.ratio);
		this.setAttackToSpn(params.attack);
		this.setReleaseToSpn(params.release);
		this.setReductionToSpn();																								//<span>
		this.drawReductBar(0);																									//<canvas>

		//drawing comp curve
		this.drawCompCurve(null, null);
	},

	/*****************************************************************************
	Compressor SW
	*****************************************************************************/
	initCompSW: function(){
		var self = this;
		//drawing SW mark
		this.cvsCompSW = document.getElementById('cvsCompSW');

		objCombProc.drawFxSw(this.cvsCompSW);

		//Get color and set Compressor SW
		var swColors = objCombProc.getFxSwColors();
		this.colorSwOn = swColors.on;
		this.colorSwOff = swColors.off;
		this.cvsCompSW.style.backgroundColor = this.colorSwOff;

		//Navigation ---------------------------------------------------------------
		this.cvsCompSW.onmouseover = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.compSW, e.clientX, e.clientY);
		};
		this.cvsCompSW.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};

		//EVENT: turn ON / OFF compressor ------------------------------------------
		this.cvsCompSW.onmousedown = function(){
			objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.compSw, true);	//manual operating
		};

		this.cvsCompSW.onclick = function(){
			self.setCompSwColor( objCombProc.switchComp() ); 
			objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.compSw, false);//end of manual operating
		};
	},
	/*============================================================================
	Set Comp SW color
	============================================================================*/
	setCompSwColor: function(isOn){
		//console.log(isOn);
		this.isCompSwON = isOn;
		if(isOn) this.cvsCompSW.style.backgroundColor = this.colorSwOn;
		else     this.cvsCompSW.style.backgroundColor = this.colorSwOff;
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation Play: Comp SW
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	playAmCompSwToComp: function(isOn){
		this.setCompSwColor(isOn);
	},


	/*****************************************************************************
	Compressor Param in span
	*****************************************************************************/
	initSpanCompParam: function(){
		/* Span background colors for focus --------------------------------------*/
		var focusColors = objCombProc.getFocusColors();
		this.colorFocusOn = focusColors.on;
		this.colorFocusOff = focusColors.off;

		/* Span: Threshold -------------------------------------------------------*/
		this.cvsThreshold = document.getElementById('cvsThreshold');
		this.spnThreshold = document.getElementById('spnThreshold');
		this.makeCompEvt(this.cvsThreshold, this.spnThreshold, 'threshold', this.cvsThresholdTop);

		/* Span: Knee ------------------------------------------------------------*/
		this.cvsKnee = document.getElementById('cvsKnee');
		this.spnKnee = document.getElementById('spnKnee');
		this.makeCompEvt(this.cvsKnee, this.spnKnee, 'knee', this.cvsKneeTop);

		/* Span: Attack ----------------------------------------------------------*/
		this.cvsAttack = document.getElementById('cvsAttack');
		this.spnAttack = document.getElementById('spnAttack');
		this.makeCompEvt(this.cvsAttack, this.spnAttack, 'attack', this.cvsAttackTop);

		/* Span: Release ---------------------------------------------------------*/
		this.cvsRelease = document.getElementById('cvsRelease');
		this.spnRelease = document.getElementById('spnRelease');
		this.makeCompEvt(this.cvsRelease, this.spnRelease, 'release', this.cvsReleaseTop);

		/* Span: Reduction(Notice! This param is read only.) ---------------------*/
		this.spnReduction = document.getElementById('spnReduction');
	},
	/*============================================================================
	Make Drag and Drop Event for Threshold, Knee, Attack, Release 
	============================================================================*/
	makeCompEvt: function(cvs, spn, param, topPos){
		var self = this;
		//Event:mouse over / out
		cvs.onmouseover = function(e){
			if(self.bufSpnVal === null) spn.style.backgroundColor = self.colorFocusOn;
			if(isNavi) objNavi.dispMsg(self.navType.compParam, e.clientX, e.clientY);
		};
		cvs.onmouseout = function(){
			spn.style.backgroundColor = self.colorFocusOff;
			if(isNavi) objNavi.hideMsg();
		};

		//Comp value control with jQuery plug-in 'Draggabilliy'
		var dndEvt = new Draggabilly(cvs, {axis: 'y'});
		//Event: mouse click -------------------------------------------------------
		dndEvt.on('pointerDown', function(){
			self.setIsManOpForCompParam(param, true);																	//manual operating
			self.bufSpnVal = parseFloat(spn.innerHTML);
			self.bufDndVal = null;
		});
		//Event: mouse drag --------------------------------------------------------
		dndEvt.on('dragMove', function(event, pointer, moveVector){
			spn.style.backgroundColor = self.colorFocusOn;
			self.chkAndUpdateParam(param, self.bufSpnVal, moveVector.y);
		});
		//Event: drag end ----------------------------------------------------------
		dndEvt.on('dragEnd', function(){
			this.element.style.top = topPos;																					//reset top position 
			spn.style.backgroundColor = self.colorFocusOff;
			self.bufSpnVal = null;
			self.bufDndVal = null;
		});
		//Event: after clicked mouse -----------------------------------------------
		dndEvt.on('pointerUp', function(){
			self.setIsManOpForCompParam(param, false);																//end of operatiing
		});
		self.dndEvts.push(dndEvt);	//regist <canvas>'s drag and drag events 
	},
	/*----------------------------------------------------------------------------
	Set manual operatiing for each Comp Parameter
	----------------------------------------------------------------------------*/
	setIsManOpForCompParam: function(param, isManOp){
		switch(param){
			case 'threshold':
				var idxTypeAM = this.enum_AM.threshold;
				break;
			case 'knee':
				var idxTypeAM = this.enum_AM.knee;
				break;
			case 'attack':
				var idxTypeAM = this.enum_AM.attack;
				break;
			case 'release':
				var idxTypeAM = this.enum_AM.attack;
				break;
		};
		objCombProc.setIsManOp(this.actSrc, null, idxTypeAM, isManOp);
	},
	/*============================================================================
	Check and Update paramater
	============================================================================*/
	chkAndUpdateParam: function(param, baseVal, delta){
		var updataVal;
		switch(param){
			case 'threshold':
				updateVal = baseVal - delta / 10;																				//1px = 0.1dB
				if(updateVal > this.maxThreshold) updateVal = this.maxThreshold;
				else if(updateVal < this.minThreshold) updateVal = this.minThreshold;
				if(this.bufDndVal === updateVal) return;																//check same value for min/max
				else this.bufDndVal = updateVal;
				this.setThresholdToSpn(updateVal);																			//<span>
				this.setThresholdMarkerPos(updateVal);																	//marker
				this.drawCompCurve(null, null);
				objCombProc.setThreshold(updateVal);
				break;
			case 'knee':
				updateVal = baseVal - delta / 10;																				//1px = 0.1
				if(updateVal > this.maxKnee)    updateVal = this.maxKnee;
				else if(updateVal < this.minKnee) updateVal = this.minKnee;
				if(this.bufDndVal === updateVal) return;																//check same value for min/max
				else this.bufDndVal = updateVal;
				this.setKneeToSpn(updateVal);																						//<span>
				this.drawCompCurve(null, null);
				objCombProc.setKnee(updateVal);
				break;
			case 'attack':
				updateVal = baseVal - delta / 100;																			//1px = 0.01sec
				if(updateVal > this.maxAttack) updateVal = this.maxAttack;
				else if(updateVal < this.minAttack) updateVal = this.minAttack;
				if(this.bufDndVal === updateVal) return;																//check same value for min/max
				else this.bufDndVal = updateVal;
				this.setAttackToSpn(updateVal);																					//<span>
				objCombProc.setAttack(updateVal);
				break;
			case 'release':
				updateVal = baseVal - delta / 100;																			//1px = 0.01sec
				if(updateVal > this.maxRelease) updateVal = this.maxRelease;
				else if(updateVal < this.minRelease) updateVal = this.minRelease;
				if(this.bufDndVal === updateVal) return;																//check same value for min/max
				else this.bufDndVal = updateVal;
				this.setReleaseToSpn(updateVal);																				//<span>
				objCombProc.setRelease(updateVal);
				break;
		}
	},
	/*============================================================================
	Set threshold value to <span>
	============================================================================*/
	setThresholdToSpn: function(threshold){
		this.spnThreshold.innerHTML = String(parseFloat(threshold).toFixed(1));
	},
	/*============================================================================
	Set knee value to <span>
	============================================================================*/
	setKneeToSpn: function(knee){
		this.spnKnee.innerHTML = String(parseFloat(knee).toFixed(1));
	},
	/*============================================================================
	Set attack value to <span>
	============================================================================*/
	setAttackToSpn: function(attack){
		this.spnAttack.innerHTML = String(parseFloat(attack).toFixed(2));
	},
	/*============================================================================
	Set Release value to <span>
	============================================================================*/
	setReleaseToSpn: function(release){
		this.spnRelease.innerHTML = String(parseFloat(release).toFixed(2));
	},
	/*============================================================================
	Set Reduction value to <span>
	============================================================================*/
	setReductionToSpn: function(){
		//DynCompressorNode's reduction is Read Only!
		if(typeof this.bufDynCompNode.reduction === 'number'){
			var redVal = this.bufDynCompNode.reduction;
		}else if(typeof this.bufDynCompNode.reduction === 'object'){
			var redVal = this.bufDynCompNode.reduction.value;
		}
		// this.spnReduction.innerHTML = String(parseFloat(this.bufDynCompNode.reduction).toFixed(1));
		this.spnReduction.innerHTML = String(parseFloat(redVal).toFixed(1));
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation Play
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Automation Play: threshold
	============================================================================*/
	playAmThresholdToComp: function(threshold){
		this.setThresholdToSpn(threshold);																					//<span>
		this.setThresholdMarkerPos(threshold);																			//marker
		this.drawCompCurve(null, null);																							//graph
	},
	/*============================================================================
	Automation Play: knee
	============================================================================*/
	playAmKneeToComp: function(knee){
		this.setKneeToSpn(knee);																										//<span>
		this.drawCompCurve(null, null);
	},
	/*============================================================================
	Automation Play: attack
	============================================================================*/
	playAmAttackToComp: function(attack){
		this.setAttackToSpn(attack);																								//<span>
	},
	/*============================================================================
	Automation Play: release
	============================================================================*/
	playAmReleaseToComp: function(release){
		this.setReleaseToSpn(release);																							//<span>
	},


/*******************************************************************************
	Ratio
	*****************************************************************************/
	initRatio: function(){
		var self = this;
		$(function($){
			//Navigaiton
			$('.radioRatio').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.compRatio, e.clientX, e.clientY);
			});
			$('.radioRatio').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});

			$('.lblValRatio').mouseover(function(e){
				if(isNavi) objNavi.dispMsg(self.navType.compRatio, e.clientX, e.clientY);
			});
			$('.lblValRatio').mouseout(function(){
				if(isNavi) objNavi.hideMsg();
			});


			// Event ratio change 
			$('.radioRatio').change(function(){
				$('.radioRatio').eq(this).prop('checked', 'checked');
				objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.ratio, true);	//manual operating
				objCombProc.setRatio(this.value);
				self.drawCompCurve(null, null);
				objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.ratio, false);	//end of manual operating
			});
		});
	},
	/*============================================================================
	Set ratio value to Radio Button
	============================================================================*/
	setRatioToRadioBtn: function(ratio){
		$('.radioRatio[value=' + String(ratio) + ']').prop('checked', 'checked');
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation Play
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Automation Play: ratio
	============================================================================*/
	playAmRatioToComp: function(ratio){
		this.setRatioToRadioBtn(ratio);																							//Radio Button
		this.drawCompCurve(null, null);																							//graph
	},


	/*****************************************************************************
	Compressor curve
	*****************************************************************************/
	initCompCurve: function(){
		//set draw area height and width(other drawing proc use these values.)
		this.cvsCompGraph = document.getElementById('cvsCompGraph');
		this.widthDrawArea = this.cvsCompGraph.width - this.offsetLeft - this.offsetRight;
		this.heightDrawArea = this.cvsCompGraph.height - this.offsetTop - this.offsetBottom;
		this.rangedB = this.maxdB - this.mindB;

		/* layer 0: set threshold marker area ------------------------------------*/
		this.cvsThMrkArea = document.getElementById('cvsThresholdMrkArea');

		/* layer 1: drawing label and grid ---------------------------------------*/
		this.drawGridAndLabel();

		/* layer 2: drawing curve from Threshold to Ratio ------------------------*/
		this.cvsCompCurve = document.getElementById('cvsCompCurve');

		/* layer 3: Threshold and Ratio Markers ----------------------------------*/
		this.spnThresholdMarker = document.getElementById('thresholdMarker');

		//Assigned markers to jQuery plug-in 'draggabiliy' and Set events
		this.eventCompMarker();
	},
	/*============================================================================
	drawing label and grid(layer 1)  
	============================================================================*/
	drawGridAndLabel: function(){
		//clear label and grid area
		var cvsCtx = this.cvsCompGraph.getContext('2d');
		cvsCtx.clearRect(0, 0, this.cvsCompGraph.width, this.cvsCompGraph.height);
		cvsCtx.fillStyle = 'rgb(0, 0, 0)';
		cvsCtx.fillRect(0, 0, this.cvsCompGraph.width, this.cvsCompGraph.height);

		//drawing axis grid and label
		cvsCtx.fillStyle = 'rgb(168, 168, 168)';
		var x, y, lbl;
		var numLine = (this.rangedB) / 10 + 1; 
		var deltaX = this.widthDrawArea / (numLine-1);
		var deltaY = this.heightDrawArea / (numLine-1);
		for(i=0; i<numLine; i++){
			x = deltaX * i + this.offsetLeft;
			y = this.cvsCompGraph.height - deltaY * i - this.offsetBottom;
			lbl =  this.mindB + i * 10;
			
			//grid 
			cvsCtx.fillRect(x, this.offsetTop, 1, this.heightDrawArea);								//x axis
			cvsCtx.fillRect(this.offsetLeft, y, this.widthDrawArea, 1);								//y axis

			//Label
			if(lbl < 0){																															//-80 to -10dB
				cvsCtx.fillText(lbl, x-9, this.cvsCompGraph.height-7);									//x axis
				cvsCtx.fillText(lbl, this.offsetLeft-20, y+4);													//y axis
			}else if(lbl === 0){																											//0dB
				cvsCtx.fillText(lbl, x-2, this.cvsCompGraph.height-7);
				cvsCtx.fillText(lbl, this.offsetLeft-10, y+4);
			}else{
				cvsCtx.fillText(lbl, x-5, this.cvsCompGraph.height-7);
				cvsCtx.fillText(lbl, this.offsetLeft-16, y+4);
			}
		}
	},

	/*============================================================================
	Drawing Compressor Curver by Threshold, knee and Ratio(layer 2)
	============================================================================*/
	drawCompCurve: function(leftThPx, topThPx){
		//Threshold position
		if(leftThPx === null && topThPx === null){
			/* Notice! ---------------------------------------------------------------
				jQuery's position().left and position.top can't get the value quickly then
				this proccess uses JavaScript's style.left and style.top.
				
				var leftThPx = $('#thresholdMarker').position().left - this.offsetLeft + 5;
				var topThPx = $('#thresholdMarker').position().top - this.offsetTop + 5;
			------------------------------------------------------------------------*/
			var leftThPx = parseInt(this.spnThresholdMarker.style.left) - this.offsetLeft + 5;
			var topThPx = parseInt(this.spnThresholdMarker.style.top) - this.offsetTop + 5;
		}

		//knee
		var knee = parseFloat(this.spnKnee.innerHTML);

		//Ratio
		var ratio = parseInt($('.radioRatio:checked').val());
		var topRatioPx = topThPx - topThPx / ratio;

		//comp curve
		datLeft = [0, leftThPx];																										//bottom-left to Threshold 
		datTop = [this.cvsCompCurve.height, topThPx];
		if(ratio !== 1 && knee !== 0){																							//knee curve
			var delKnee = knee / 10 / this.rangedB * this.widthDrawArea; 
			for(var i=1, len=this.norm_knee_curve.length; i<len; i++){
				datLeft.push(delKnee * i + leftThPx);
				datTop.push(topThPx - this.norm_knee_curve[i] * 8 / ratio  * knee / 10 / this.rangedB * this.widthDrawArea);
			}
		}
		datLeft.push(this.widthDrawArea);																						//bottom-left of knee or Threshold to Ratio
		datTop.push(topRatioPx);

		//Drawing compression curve
		var ctxCompCurve = this.cvsCompCurve.getContext('2d');
		ctxCompCurve.clearRect(0, 0, this.cvsCompCurve.width, this.cvsCompCurve.height);
		ctxCompCurve.strokeStyle = 'rgb(255, 255, 255)';
		ctxCompCurve.beginPath();
		for(var i=0, len=datLeft.length; i<len; i++){
			if(i===0){
				ctxCompCurve.moveTo(datLeft[i], datTop[i]);
			}else{
				ctxCompCurve.lineTo(datLeft[i], datTop[i]);
			}
		}
		ctxCompCurve.stroke();
	},

	/*============================================================================
	Assigned an Event as Threshold and Ratio Markers(layer 3)  
	============================================================================*/
	eventCompMarker: function(){
		var self = this;
		//Navigation ---------------------------------------------------------------
		self.spnThresholdMarker.onmousemove = function(e){
			if(isNavi) objNavi.dispMsg(self.navType.compMarker, e.clientX, e.clientY);
		};
		self.spnThresholdMarker.onmouseout = function(){
			if(isNavi) objNavi.hideMsg();
		};

		//EVENT: Threshold Marker --------------------------------------------------
		var evtMrk = new Draggabilly(self.spnThresholdMarker, {containment: '#cvsThresholdMrkArea', axis: 'y'} );

		//EVENT:mouse click --------------------------------------------------------
		evtMrk.on('pointerDown', function(){
			objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.threshold, true);	//manual operating 
		});
		//EVENT: marker draggin ----------------------------------------------------
		evtMrk.on('dragMove', function(){
			//This px value is already adapted to dB for threshold marker's top position.
			var y = this.dragPoint.y + this.relativeStartPosition.y;
			if(y > self.heightDrawArea) y = self.heightDrawArea;		//adjust px coz of computation error
			if(self.bufY === y) return;															//check same value for min/max
			else self.bufY = y;

			//Set threshold marker position as x-axis
			var x = self.heightDrawArea - y;	//threshold expresses as a formuler 'y = x'.
			self.spnThresholdMarker.style.left = String(x + self.offsetLeft - 5) + 'px'; //5 is half width of marker
			//console.log('x:' + x + ' y:' + y);

			//Drawing Comp curve
			self.drawCompCurve(x, y);

			//Set threshold value to <span>
			var th = x / self.widthDrawArea * self.rangedB + self.minThreshold;
			self.setThresholdToSpn(th);
			objCombProc.setThreshold(th);
		});
		//EVENT: drag end ----------------------------------------------------------
		evtMrk.on('dragEnd', function(){
			var y = this.dragPoint.y + this.relativeStartPosition.y;
			if(y > self.heightDrawArea) y = self.heightDrawArea;	//adjust px coz of computation error

			//Set threshold marker position as x-axis
			var x = self.heightDrawArea - y;	//threshold expresses as a formuler 'y = x'.
			self.spnThresholdMarker.style.left = String(x + self.offsetLeft - 5) + 'px'; //5 is half width of marker
		
			self.bufY = null;
		});
		//EVENT: after clicked mouse -----------------------------------------------
		evtMrk.on('pointerUp', function(event){
			objCombProc.setIsManOp(self.actSrc, null, self.enum_AM.threshold, false);	//end of manual operating 
		});
		self.evtCompMarker.push(evtMrk);	//set the event of threshold
	},

	/*============================================================================
	Set threshold Marker from a value(layer 3)  
	============================================================================*/
	setThresholdMarkerPos: function(threshold){
		leftPx = (threshold - this.mindB) / this.rangedB * this.widthDrawArea + this.offsetLeft - 5; //5px is the half of marker width.
		this.spnThresholdMarker.style.left = String(leftPx) + 'px';

		var topPx = -(threshold - this.maxdB) / this.rangedB * this.heightDrawArea + this.offsetTop - 5;
		this.spnThresholdMarker.style.top = String(topPx) + 'px';
	},


	/*****************************************************************************
	Reduction
	*****************************************************************************/
	initReduction: function(){
		this.cvsCompReductGraph = document.getElementById('cvsCompReductGraph');
		this.cvsCompReduction = document.getElementById('cvsCompReduction');

		//Graph bar for Reduction(layer 0) -----------------------------------------
		this.drawReductBar();

		//Graph axis for Reduction(layer 1) ----------------------------------------
		this.drawReductGraphAxis();
	},
	/*============================================================================
	Graph bar for Reduction(layer 0)
	============================================================================*/
	drawReductBar: function(reduction){
		var cvsCtx = this.cvsCompReduction.getContext('2d');
		cvsCtx.clearRect(0, 0, this.cvsCompReduction.width, this.cvsCompReduction.height);
		cvsCtx.fillStyle = 'rgb(0, 140, 0)';

		var y = -reduction / this.rangedB * this.heightDrawArea;
		cvsCtx.fillRect(0, 0, 12, y);
	},
	/*============================================================================
	Graph axis for Reduction(layer 1)
	============================================================================*/
	drawReductGraphAxis: function(){
		var cvsCtx = this.cvsCompReductGraph.getContext('2d');
		cvsCtx.clearRect(0, 0, this.cvsCompReductGraph.width, this.cvsCompReductGraph.height);
		cvsCtx.fillStyle = 'rgb(0, 0, 0)';
		//cvsCtx.fillRect(0, 0, this.cvsCompGraph.width, this.cvsCompGraph.height);
		cvsCtx.strokeStyle = 'rgb(168, 168, 168)';
		
		//vartical grid
		cvsCtx.beginPath();
		cvsCtx.strokeRect(4, this.offsetTop, 1, this.heightDrawArea);
		cvsCtx.strokeRect(16, this.offsetTop, 1, this.heightDrawArea);
		cvsCtx.stroke();
		
		//horizontal grid
		cvsCtx.beginPath();
		var y;
		var numLine = this.rangedB / 10 + 1;
		var deltaY = this.heightDrawArea / (numLine-1); 
		//console.log(deltaY);
		for(i=0; i<numLine; i++){
			y = this.cvsCompGraph.height - deltaY * i - this.offsetBottom;
			cvsCtx.strokeRect(4, y, 12, 1);
		}
		cvsCtx.stroke();

		//Label
		cvsCtx.fillStyle = 'rgb(168, 168, 168)';
		cvsCtx.fillText('Red.', 0, this.cvsCompReductGraph.height-7);
	},

	/*****************************************************************************
	RealTime proc
	*****************************************************************************/
	updateReductionToComp: function(){
		if(typeof this.bufDynCompNode.reduction === 'number'){				//FireFox, Chrome
			var redVal = this.bufDynCompNode.reduction;
		}else if(typeof this.bufDynCompNode.reduction === 'object'){	//Safari
			var redVal = this.bufDynCompNode.reduction.value;
		}
		if(this.isCompSwON){
			this.drawReductBar(redVal);																								//<canvas>
			this.setReductionToSpn();																									//<span>
		}
	},
};//EOF objComp



/*******************************************************************************
Combination process
*******************************************************************************/
var objCombProc = {

	/*----------------------------------------------------------------------------
	Audio for XHR, WebAudioAPI and Track
	----------------------------------------------------------------------------*/
	audioDir: 'mp3/',
	fileExt:  '.mp3',

	songfiles: [
		['t00_SynthBa', 0], 
		['t01_Kick',    0],
		['t02_Snare',   0],
		['t03_CloseHH', 0],
		['t04_OpenHH',  0],
		['t05_Crash',   0],
		['t06_Splash',  0],
		['t07_Claves',  22.857],
		['t08_Pf',      7.619],			//check and change
		['t09_Melo',    26.666],
		['t10_Pad1',    26.666],
		['t11_Organ',   57.142],
		['t12_Pad2',    57.142],
		['t13_Seq2',    57.142],
		['t14_Lead',    72.380],
		['t15_Bell',    72.380],
		['t16_Str',     72.380],
		['t17_Seq3',    72.380],
	],

	//!!! check and set original time partA to outro
	startSoundPos: [
			['intro',   0.0],
			['partA',  26.636],	//26.666(org)
			['partB',  57.142],
			['partC',  72.380],
			['outro', 102.760],	//102.857(org)
			['end',   121.984],	//end of song
	],
	startPartSec: [
		0,						//intro
		26.636,				//part A: 26.666(org)
		57.142,				//part B
		72.380,				//part B
		102.760,			//Outro: 102,857(org)
		121.904,			//end of song
	],

	numLoadedAudio: null,	//number of loaded audio files
	numPartCh:   null,	//number of part Chs
	idxOutputCh: null,	//index of output Ch is part Ch numbers add 1.
	chNames: null,

	filterNames: ['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass'],

	prjMaxTime: 180,	//180(sec) = 3min - maximum project time 


	/*----------------------------------------------------------------------------
	Tranporse
	----------------------------------------------------------------------------*/
	isReturn: false,							//True: Return Mode is ON.
	returnTime: null,						//Return time sets at stop sound
	isRepeat: null,							//True: Repeat Mode is ON.
	isAvailableRepeat: true,		//True: Repeat mode is available.
	isOverRepeatEndTime: false,	//True: play time assigned from Play Line or Transport
	repeatStartTime: 0,
	repeatEndTime: 10,
	isPlayedTimeChg: false,			//True: changing Played Time in Transpose by Drag and Drop event


	/*----------------------------------------------------------------------------
	Inspector
	----------------------------------------------------------------------------*/
	inspectorCh: 0,							//current Inspector's Ch


	/*----------------------------------------------------------------------------
	Mixer
	----------------------------------------------------------------------------*/
	isAutoDispPosMixIcon: false,	//True: Icon of Position Mixer showing automatically at played Time 


	/*----------------------------------------------------------------------------
	FX
	----------------------------------------------------------------------------*/
	fxCh: 0,											//current FX's Ch


	/*----------------------------------------------------------------------------
	Part Ch color for Track, Mixer
	----------------------------------------------------------------------------*/
	btnColors: {
		norm:   'white',				//normal(default)
		mute :   'yellow',				//mute
		solo:   'lightgreen',		//solo
		playAM: 'lightskyblue',	//Play AutoMation
		recAM:  'lightCoral',		//Rec AutoMation
	},
	enum_btnColor:{
			'norm':		0,
			'mute': 	1,
			'solo':		2,
			'playAM': 3,
			'RecAM':	4,
			'repeat':	5,
	},
	trackColors: [
		'#ffa07a',		//LightSalmon
		'#f08080',		//LightCoral
		'#ff8c00',		//DarkOrange
		'#ffffe0',		//LightYellow
		'#f0e68c',		//Khaki
		'#ffd700',		//Gold
		'#98fb98',		//PaleGreen
		'#00fa9a',		//MediumSpringGreen
		'#32cd32',		//LimeGreen
		'#afeeee',		//PaleTurquoise
		'#00ffff',		//aqua
		'#87cefa',		//LightSkyBlue
		'#fff0f5',		//LavenderBlush	
		'#dda0dd',		//Plum
		'#ee82ee',		//Violet
		'#ffb6c1',		//LightPink
		'#ffc0cb',		//Pink
		'#ff69b4',		//HotPink
		'#f0ffff',		//Azure for Master Out
	],
	trackImg: [
		't00_SynthBa.png',
		't01_Kick.png',
		't02_Snare.png',
		't03_CloseHH.png',
		't04_OpenHH.png',
		't05_Crash.png',
		't06_Splash.png',
		't07_Claves.png',
		't08_Pf.png',
		't09_Melo.png',
		't10_Pad1.png',
		't11_Organ.png',
		't12_Pad2.png',
		't13_Seq2.png',
		't14_Lead.png',
		't15_Bell.png',
		't16_Str.png',
		't17_Seq3.png',
		'output.png'
	],
	imgDir: 'fig',

	instType: [
		'rythm',		//t00_SynthBa
		'rythm',		//t01_Kick
		'rythm',		//t02_Snare
		'rythm',		//t03_CloseHH
		'rythm',		//t04_OpenHH
		'rythm',		//t05_Crash
		'rythm',		//t06_Splash
		'rythm',		//t07_Claves
		'chord',		//t08_Pf
		'partA',		//t09_Melo
		'partA',		//t10_Pad1
		'partB',		//t11_Organ
		'partB',		//t12_Pad2
		'partB',		//t13_Seq2
		'partC',		//t14_Lead
		'partC',		//t15_Bell
		'partC',		//t16_Str
		'partC',		//'t17_Seq3
	],


	/*----------------------------------------------------------------------------
	Effect
	----------------------------------------------------------------------------*/
	fxSwColors: {		//EQ / Comp SW colors
		on: 'MediumSeaGreen',
		off: 'DarkGray',
	},
	focusColors: {	//focus colors of <span> for param
		on:  'azure',
		off: 'white',
	},


	/*----------------------------------------------------------------------------
	Automation
	----------------------------------------------------------------------------*/
	workerAM: null,	//for each part
	arrayAm: null,
	enum_swAM:{
		on:  1,	//on  - true
		off: 0,	//off - false
	},
	typeAM: [
		'Volume',
		'Pan',
		'EQ SW',
		'Filter No.1 SW',   'Filter No.2 SW',   'Filter No.3 SW',   'Filter No.4 SW',
		'Filter No.1 Type', 'Filter No.4 Type',
		'Filter No.1 Freq', 'Filter No.2 Freq', 'Filter No.3 Freq', 'Filter No.4 Freq', 
		'Filter No.1 Q',    'Filter No.2 Q',    'Filter No.3 Q',    'Filter No.4 Q',
		'Filter No.1 Gain', 'Filter No.2 Gain', 'Filter No.3 Gain', 'Filter No.4 Gain',
		'Compressor SW',
		'Threshold',
		'Knee',
		'Ratio',
		'Attack',
		'Release',
	],
	volAmInfo: {
		type: 'range',
		val: [1, 0],
		txt: ['max', 'min'], 
		bgColor: ['', ''],
		digit: 2,
		step: 0.01,
	},
	panAmInfo: {
		type: 'range',
		val: [1.57, -1.57],
		txt: ['R', 'L'],
		bgColor: ['', ''],
		digit: 2,
		step: 0.01,
	},
	//for eqSW, filtSW0:3, compSW
	swAmInfo: {
		type: 'select',
		val:[1, 0],					//1:true, 0:false
		txt:['ON', 'OFF'],
		bgColor: ['lightgreen', 'lightgray']
	},
	filtType0AmInfo: {
		type: 'select',
		val: [3, 5],
		txt: ['LowShelf', 'Peaking'],
		bgColor: ['LightCoral', 'lightskyblue']
	},
	filtType3AmInfo: {
		type: 'select',
		val: [4, 5],
		txt:['HighShelf', 'Peaking'],
		bgColor: ['orange', 'lightskyblue']
	},
	filtFreqAmInfo: {
		type: 'range',
		val: [20000, 10],
		txt: ['20k', '10'],
		bgColor: ['', ''],
		digit: 0,
		step: 1,
	},
	filtQAmInfo: {
		type: 'range',
		val: [30, 0.1],
		txt: ['30.0', '0.1'],
		bgColor: ['', ''],
		digit: 1,
		step: 0.1,
	},
	filtGainAmInfo: {
		type: 'range',
		val: [30.0, -30.0],
		txt: ['30.0', '-30.0'],
		bgColor: ['', ''],
		digit: 1,
		step: 0.1,
	},
	thresholdAmInfo: {
		type: 'range',
		val: [0, -60],
		txt: ['0.0', '-60.0'],
		bgColor: ['', ''],
		digit: 1,
		step: 0.1,
	},
	kneeAmInfo: {
		type: 'range',
		val: [30, 0],
		txt: ['30.0', '0.0'],
		bgColor: ['', ''],
		digit: 1,
		step: 0.1,
	},
	ratioAmInfo: {
		type: 'select',
		val: [1, 2, 4, 8],
		txt: ['1:1', '1:2', '1:4', '1:8'],
		bgColor: ['lightgray', 'lightskyblue', 'lightgreen', 'orange']
	},
	atkRelAmInfo: {
		type: 'range',
		val: [1, 0],
		txt: ['1.00', '0.00'],
		bgColor: ['', ''],
		digit: 2,
		step: 0.01,
	},
	infoAM: null,

	enum_AM: {
		'vol':0, 
		'pan':1,
		'eqSw':2,
		'filtSw0':3,
		'filtSw1':4,
		'filtSw2':5,
		'filtSw3':6,
		'filtType0': 7,
		'filtType3': 8,
		'filtFreq0': 9,
		'filtFreq1':10,
		'filtFreq2':11,
		'filtFreq3':12,
		'filtQ0':13,
		'filtQ1':14,
		'filtQ2':15,
		'filtQ3':16,
		'filtGain0':17,
		'filtGain1':18,
		'filtGain2':19,
		'filtGain3':20,
		'compSw':21,
		'threshold':22,
		'knee':23,
		'ratio':24,
		'attack':25,
		'release':26,
	},
	numTypeAM: null,	//number of Automation Type 
	chAM: [],					//Automation data for each Part Ch.
	stateAM: [],
	enum_stateAM:{
		stop: 'stop',
		rec:  'rec',
		play: 'play',
	},
	isAmRec: false, //true: any ch in Automation rec mode


	/* Loading -----------------------------------------------------------------*/
	e_divLoading: null,
	e_progLoading: null,		//progress 
	e_spnPercLoading: null,	//percent for progress

	/* Display mode ------------------------------------------------------------*/
	e_divTrack: null,	//Track
	e_divMixer: null,	//Mixer
	e_divFX:    null,	//FX

	actSrc: {
		transpose: 'transpose',
		inspector: 'inspector',
		track: 'track',
		mixer: 'mixer',
		fx:    'fx',
		eq:    'eq',
		comp:  'comp',
	},

	/*============================================================================
	init
	============================================================================*/
	init: function(){
		var self = this;
		/* Part Ch / MasterOut ---------------------------------------------------*/
		self.numPartCh = self.songfiles.length;		//Part Ch:sounds[0, 1,...,numPartCh-1]
		self.idxOutputCh = self.songfiles.length;	//MasterCh:sounds[numpartCh]
		self.chNames = new Array(sounds.length);
		for(i=0, len=sounds.length; i<len; i++){
			self.chNames[i] = sounds[i].name;
		}

		/* for Loading -----------------------------------------------------------*/
		this.e_divLoading = document.getElementById('loading');
		this.e_progLoading = document.getElementById('progLoading');
		this.e_spnPercLoading = document.getElementById('spnPercLoading');

		/* display mode ----------------------------------------------------------*/
		this.e_divTrack = document.getElementById('track');
		this.e_divMixer = document.getElementById('mixer');
		this.e_divFX = document.getElementById('FX');
		this.switchDispMode('Track');

		/* for Transpose & Track -------------------------------------------------*/
		self.isPlaying = false;
		self.isRepeat = false;

		/* Automation ------------------------------------------------------------*/
		this.initAutomation();
	},//EOF init


	/*****************************************************************************
	Common procss
	*****************************************************************************/
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Audio File
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	getAudioDirExt: function(){
		return {
			dir: this.audioDir,
			ext: this.fileExt,
		};
	},

	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Display
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	getActSrc: function(){
		return this.actSrc;
	},

	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Channel
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Set fx Ch
	============================================================================*/
	setFxCh: function(chgCh){
		this.fxCh = chgCh;
	},
	/*============================================================================
	Get fx Ch
	============================================================================*/
	getFxCh: function(){
		return this.fxCh;
	},

	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Song Time, position
	+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++/
	/*============================================================================
	Get Start Part Sec - each Part(intro/Part A,B,C/Outro) time
	============================================================================*/
	getStartPartSec: function(){
		return this.startPartSec;
	},
	/*============================================================================
	Get Start Sounds Position -  each Part(intro/Part A,B,C/Outro) name and time
	============================================================================*/
	getStartSoundPos: function(){
		return this.startSoundPos;
	},
	/*============================================================================
	Get Maximum project time[sec]
	============================================================================*/
	getPrjMaxTime: function(){
		return this.prjMaxTime;
	},
	/*============================================================================
	Get playTime
	============================================================================*/
	getPlayTime: function(){
		return playedTime;
	},
	/*============================================================================
	Get Return Mode
	============================================================================*/
	getReturnMode: function(){
		return this.isReturn;
	},
	/*============================================================================
	Get Repeat Mode
	============================================================================*/
	getRepeatMode: function(){
		return this.isRepeat;
	},
	/*============================================================================
	Get Repeat Start amd End Time 
	============================================================================*/
	getRepeatStartEndTime: function(){
			return {
				repeatStartTime: this.repeatStartTime,
				repeatEndTime: this.repeatEndTime
			};
	},
	/*============================================================================
	Check Available Repeat
	============================================================================*/
	chkAvailableRepeat: function(){
		if(this.repeatStartTime < this.repeatEndTime)	this.isAvailableRepeat = true;
		else this.isAvailableRepeat = false;
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Common Proc for change Played Time in Transpose, Track, Short Cut
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	cmnProcChgPtOnPlaying: function(){
		if(state === enum_states.play){
			if(this.isStoppedAllSounds()){	//All sounds have already stopped
				worker.postMessage('stop');		//stop an interval Worker process
				this.playAudio();
			}else{
				this.stopAudio('reStart');
			}
		
			//Reset current index of Automation Rec 
			//if(this.isAmRec) this.resetCurrIdxOfAmRec(); 
			//Reset all automation data index 
			this.resetAllAmDatIdx(); 
		}
	},


	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	sounds
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Set Output Ch EQ / Comp param for Mac Safari
	============================================================================*/
	setOutputChEqCompParamForMacSafari: function(){
		//EQ
		sounds[this.idxOutputCh].switchEQ(true);					//EQ SW:ON
		//Filter No.2
		sounds[this.idxOutputCh].switchFilter(1, true); 	//Filter No.2:ON
		sounds[this.idxOutputCh].chgFilterFreq(1, 80); 		//Filter No.2:Frequency
		sounds[this.idxOutputCh].chgFilterQ(1, 0.9); 			//Filter No.2:Q
		sounds[this.idxOutputCh].chgFilterGain(1, -3.0);	//Filter No.2:Gain
		//Filter No.3
		sounds[this.idxOutputCh].switchFilter(2, true); 	//Filter No.3:ON
		sounds[this.idxOutputCh].chgFilterFreq(2, 200); 	//Filter No.3:Frequency
		sounds[this.idxOutputCh].chgFilterQ(2, 0.7); 			//Filter No.3:Q
		sounds[this.idxOutputCh].chgFilterGain(2, -3.0);	//Filter No.3:Gain
		//Filter No.4
		sounds[this.idxOutputCh].switchFilter(3, true); 	//Filter No.4:ON
		sounds[this.idxOutputCh].chgFilterFreq(3, 2724); 	//Filter No.4:Frequency
		sounds[this.idxOutputCh].chgFilterGain(3, 14.0);		//Filter No.4:Gain

		//Comp
		sounds[this.idxOutputCh].switchComp(true);				//Comp SW:ON
		sounds[this.idxOutputCh].setThreshold(-6.0);			//Comp Threshold
		sounds[this.idxOutputCh].setKnee(3.0);						//Comp Knee
		sounds[this.idxOutputCh].setRatio(2);							//Comp Ratio
		sounds[this.idxOutputCh].setAttack(0.5);					//Comp Attack
		sounds[this.idxOutputCh].setRelease(0.5);					//Comp Release
	},
	/*============================================================================
	Get Pan, Gain, Ch.Mode from Sounds
	============================================================================*/
	getPanGainChModeFromSounds: function(srcObj, idxCh){
		if(srcObj === this.actSrc.inspector) idxCh = this.inspectorCh;
		else if(srcObj === this.actSrc.fx) idxCh = this.fxCh;
		var panGainChMode = sounds[idxCh].getPanGainChMode();
		return {
			pan: panGainChMode.pan,
			gain: panGainChMode.gain,
			chMode: panGainChMode.chMode,
			stateAM: this.stateAM[idxCh],
			imgSrc: this.imgDir + '/' + this.trackImg[idxCh],
			trColor: this.trackColors[idxCh],
			trName: this.songfiles[idxCh][0],
		};
	},
	/*============================================================================
	Get All Ch Pan and Gain To Sound 
	============================================================================*/
	getAllChPanGainToSound: function(){
		var panGainChMode;
		gains = new Array(this.numPartCh+1);
		pans = new Array(this.numPartCh+1);
		for(var i=0; i<=this.numPartCh; i++){	//numPartCh means output ch.
			panGainChMode = sounds[i].getPanGainChMode();
			gains[i] = panGainChMode.gain;
			pans[i] = panGainChMode.pan;
		}

		return {
			pans: pans,
			gains: gains,
		};
	},
	/*============================================================================
	Get Mute / Solo mode of Part Ch to Sound
	============================================================================*/
	getMuteSoloOfPartChToSound: function(){
		var isChMute = false;
		var isChSolo = false;
		for(var i=0; i<this.numPartCh; i++){
			switch(sounds[i].getChMode()){
				case 'mute':
					isChMute = true;
					break;
				case 'solo':
					isChSolo = true;
					break;
			};
		}
		return {
			mute: isChMute,
			solo: isChSolo
		};
	},
	/*============================================================================
	Get Filter Names
	============================================================================*/
	getFilterNames: function(){
		return this.filterNames;
	},
	/*============================================================================
	Get button color
	============================================================================*/
	getBtnColors: function(){
		return this.btnColors;
	},
	/*============================================================================
	Get Master Ch index
	============================================================================*/
	getOutputChIdx: function(){
		return this.idxOutputCh;
	},
	/*============================================================================
	Get Part Ch color
 	============================================================================*/
	getPartChColor: function(){
		return this.trackColors
	},
	/*============================================================================
	Get Ch names
	============================================================================*/
	getChNames: function(){
		return this.chNames;
	},
	/*============================================================================
	Get Image Path
	============================================================================*/
	getImgPath: function(){
		return {
			dir:   this.imgDir,
			files: this.trackImg
		};
	},
	/*============================================================================
	Get Inst Type
	============================================================================*/
	getInstType: function(){
		return this.instType;
	},
	/*============================================================================
	array number of sounds
	============================================================================*/
	getSoundsNum: function(){
		if(sounds){
			return this.numPartCh;
		}
	},
	/*============================================================================
	Get Fx SW Colors
	============================================================================*/
	getFxSwColors: function(){
		return this.fxSwColors;
	},
	/*============================================================================
	Draw Fx SW
	============================================================================*/
	drawFxSw: function(cvs){
		//drawing SW mark
		var cvsCtx = cvs.getContext('2d');
		cvsCtx.clearRect(0, 0, cvs.width, cvs.height);

		cvsCtx.strokeStyle = 'rgb(256, 256, 256)';
		cvsCtx.lineCap = "round";
		cvsCtx.lineWidth = 3;
		cvsCtx.beginPath();
		cvsCtx.moveTo(15, 6);
		cvsCtx.lineTo(15, 15);
		cvsCtx.stroke();

		cvsCtx.beginPath();
		cvsCtx.arc(15, 15, 8, -Math.PI/4 , Math.PI*5/4, false);
		cvsCtx.stroke();
	},
	/*============================================================================
	Get Focus Colors of <span> for params
	============================================================================*/
	getFocusColors: function(){
		return this.focusColors;
	},


	/*****************************************************************************
	from XMR HTTP Request

	Notice!
	Accessing an assignment URL on Mac OS X Safari without cash doesn't count up
  audioContext.currentTime in Web Audio API. Meanwhile, currentTime counts up
	correctly when Safari has a cash for this site.
	Thus Safari needs to reload the site to count up currentTime correctly.  
	
	So, loading an audio file at frist checks currentTime in this function. 
  This function will reload this web site if currentTime is still 0.
	*****************************************************************************/
	setAudioBufferFromXHRtoTrack: function(index, buffer){
		if(context.currentTime === 0) location.reload(); //for Safari 

		sounds[index].audioBuffer = buffer;
		sounds[index].duration = buffer.duration;
		sounds[index].wavData = new Float32Array(buffer.length);
		if(buffer.numberOfChannels > 0){
			sounds[index].wavData.set(buffer.getChannelData(0));
			//objTrack.setSoundParamToTrack(index, sounds[index].duration, sounds[index].wavData, this.startSoundPos[sounds[index].part]);
			objTrack.setSoundParamToTrack(index, sounds[index].duration, sounds[index].wavData, sounds[index].startTime);
		}
		//check playable sound or not.
		var numLoadedAudio = 0;
		for(var i=0; i<this.numPartCh; i++){
			if(sounds[i].duration !== null) numLoadedAudio++;
		}
		if(numLoadedAudio === this.numPartCh) state = enum_states.stop;							//All sound files loaded.
		//console.log('state:' + state + ' numLoadedAudio:' + numLoadedAudio);

		//for Loading
		var progRatio = numLoadedAudio / this.numPartCh;
		this.e_divLoading.style.opacity = 1 - progRatio;
		this.e_progLoading.value = progRatio;
		this.e_spnPercLoading.innerHTML = String(parseInt(progRatio * 100)) + '%';
		if(progRatio === 1) this.e_divLoading.style.display = 'none'; 
	},


	/*****************************************************************************
	from document(Shortcut key)
	*****************************************************************************/
	/*============================================================================
	Start / Stop sounds 
	============================================================================*/
	startAndStopSoundsFromDoc: function(){
		if(state === enum_states.stop){
			objCombProc.playAudio();						//play sound
			objTranspose.setPlayCvsColor(true);
		}else if(state === enum_states.play){
			objCombProc.stopAudio('');					//stop sound
			objTranspose.setPlayCvsColor(false);
		} 
	},
	/*============================================================================
	Display in Track
	============================================================================*/
	chgDisplayFromDoc: function(keyCode){
		switch(keyCode){
			case 49: //Key '1'
				this.switchDispMode('Track');
				break;
			case 50: //Key '2'
				this.switchDispMode('Mixer');
				break;
			case 51: //Key '3'
				this.switchDispMode('FX');
				break;
		};
	},
	/*============================================================================
	Return mode on and off
	============================================================================*/
	chgReturnModeFromDoc: function(){
		this.isReturn = !this.isReturn;
		objTranspose.setReturnMode(this.isReturn);
	},
	/*============================================================================
	Repeat play on and off
	============================================================================*/
	chgModeRepeatPlayFromDoc: function(){
		//console.log('chgModeRepeatPlayFromDoc @ objCombProc');
		this.isRepeat = !this.isRepeat;							//change Repeat mode state
		objTranspose.setRepeatMode(this.isRepeat);
		objTrack.setRepeatMode(this.isRepeat);
	},
	/*============================================================================
	Move StartPosition
	============================================================================*/
	moveStartPosFromDoc: function(){
		playedTime = 0;															//set 0 sec 
		objTranspose.setPlayedTime(playedTime);			//set Play 'TIME' on Transpose
		objTrack.setPlayLinePos(playedTime);				//set Play 'LINE' on Track

		/* Playing ---------------------------------------------------------------*/
		this.cmnProcChgPtOnPlaying();
	},


	/*****************************************************************************
	Worker
	*****************************************************************************/
	workerProc: function(){
		//console.log('currentTime: ' + context.currentTime + ' startTime: ' + startTime);
		if(context.currentTime - startTime < 0) return;
		playedTime = context.currentTime - startTime + offsetTime;	//update playedTime

		if(playedTime >= this.prjMaxTime && objCombProc.isStoppedAllSounds() ){
			worker.postMessage('stop');						//stop an interval Worker process
			objTranspose.setPlayCvsColor(false);	//set Play Button back ground color
			state = enum_states.stop;							//state: stop
		} 

		if(!this.isPlayedTimeChg) objTranspose.setPlayedTime(playedTime);	//set Play 'TIME' on Transpose
		objTrack.setPlayLinePos(playedTime);		//set Play 'LINE' on Track
		objEQ.darwEqSpectrum();									//draw Spectrum for EQ
		objComp.updateReductionToComp();				//set Compressor reduction value

		if(this.isRepeat && this.isAvailableRepeat){
			if(this.repeatEndTime <= playedTime && playedTime <= this.repeatEndTime + 0.5){
				playedTime = this.repeatStartTime;
				if(objCombProc.isStoppedAllSounds()){		//All sounds have already stopped
					worker.postMessage('stop');						//stop an interval Worker process
					this.playAudio();
				}else{
					this.stopAudio('reStart');
				}
			}
		}
	
		//Auto display Icon in Mixer  
		if(this.isAutoDispPosMixIcon) objMixer.autoDispPosMixIcnToMixer(playedTime);
	},


	/*****************************************************************************
	Automation
	*****************************************************************************/
	initAutomation: function(){
		/* Part Ch ---------------------------------------------------------------*/
		this.numTypeAM = Object.keys(this.enum_AM).length;	//set numTypeAM

		//make arrays of automation for each Part Ch.
		this.chAM = new Array(this.numPartCh);
		for(var i=0; i<this.numPartCh; i++){
			this.chAM[i] = new Array(this.numTypeAM);	//preparation array for AM type
		}
		for(var i=0; i<this.numPartCh; i++){				//set AM data
			for(var j=0; j<this.numTypeAM; j++){
				this.chAM[i][j] = {
					datIdx:null,			//Rec to check the last written idx, Play to access next data  
					time:[],					//recorded time
					val:[], 					//value
					isEditing: false,	//true: editing in objTrack
					isManOp: false,		//true: manual operating in Automation Playing
				};
			}
		}
		//automation rec state
		this.stateAM = new Array(this.numPartCh);
		for(var i=0; i<this.numPartCh; i++){
			this.stateAM[i] = this.enum_stateAM.stop;
		}

		/* make Automation info --------------------------------------------------*/
		this.makeInfoAM();

		/* Worker for Automation -------------------------------------------------*/
		this.initWorkerAM();
	},
	/*----------------------------------------------------------------------------
	make Automation info
	----------------------------------------------------------------------------*/
	makeInfoAM: function(){
		this.infoAM = new Array(this.numTypeAM);
		for(var i=0; i<this.numTypeAM; i++){
			switch(i){
				case 0:  //Vol
					this.infoAM[i] = this.volAmInfo;
					break;
				case 1:  //Pan
					this.infoAM[i] = this.panAmInfo;
					break;
				case 2:  //EQ SW
				case 3:  //Filter SW 0 
				case 4:  //Filter SW 1
				case 5:  //Filter SW 2
				case 6:  //Filter SW 3
				case 21: //Compressor SW
					this.infoAM[i] = this.swAmInfo;
					break;
				case 7:  //Filter Type0
					this.infoAM[i] = this.filtType0AmInfo;
					break;
				case 8: //Filter Type3
					this.infoAM[i] = this.filtType3AmInfo;
					break;
				case  9: //Filter Freq0
				case 10: //Filter Freq1
				case 11: //Filter Freq2
				case 12: //Filter Freq3
					this.infoAM[i] = this.filtFreqAmInfo;
					break;
				case 13: //Filter Q0
				case 14: //Filter Q1
				case 15: //Filter Q2
				case 16: //Filter Q3
					this.infoAM[i] = this.filtQAmInfo;
					break;
				case 17: //Filter Gain0
				case 18: //Filter Gain1
				case 19: //Filter Gain2
				case 20: //Filter Gain3
					this.infoAM[i] = this.filtGainAmInfo;
					break;
				case 22: //Threshold
					this.infoAM[i] = this.thresholdAmInfo;
					break;
				case 23: //Knee
					this.infoAM[i] = this.kneeAmInfo;
					break;
				case 24: //Ratio
					this.infoAM[i] = this.ratioAmInfo;
					break;
				case 25: //Attack
				case 26: //Release
					this.infoAM[i] = this.atkRelAmInfo;
					break;
			}
		}
	},

	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Worker for AutoMation
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	initWorkerAM: function(){
		var self = this;
		this.workerAM = new Array(this.numPartCh);
		for(var i=0; i<this.numPartCh; i++){
			this.workerAM[i] = new Worker('js/worker-am.js');
			this.workerAM[i].addEventListener('message', function(e){
				var data = e.data;
				switch(data.mode){
					case 'rec':
						//console.log('rec of main th');
						self.chAM[data.ch][data.type].push([data.time, data.val]);
						break;
					case 'play':
						//console.log('play @ main th');
						if(playedTime >= 0) self.playAutomation(data.ch);
						break;
					case 'stop':
						//console.log('stop @ main th');
						break;
				}
			}, false);
		}
	},

	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation Rec
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Rec Automation from each event
	============================================================================*/
	recAutomation: function(ch, type, recTime, val){
		if(ch === this.idxOutputCh) return;																					//output ch. doesnt' use Automation
		//console.log('ch:'+ch);
		var len = this.chAM[ch][type].time.length;
		for(var i=0; i<len; i++){
			if(recTime < this.chAM[ch][type].time[i]){																//before a recorded time
				if(i === 0){																														//before index [0]
					this.chAM[ch][type].time.unshift(recTime);
					this.chAM[ch][type].val.unshift(val);
				}else{																																	//before index [i]
					this.chAM[ch][type].time.splice(i, 0, recTime);
					this.chAM[ch][type].val.splice(i, 0, val);
				}
				var currIdx = i;
				//set a current index of Automation Rec
				if(this.chAM[ch][type].datIdx === null) this.chAM[ch][type].datIdx = i;
				break;
			}else if(recTime === this.chAM[ch][type].time[i]){												//same time
				this.chAM[ch][type].time[i] = recTime;
				this.chAM[ch][type].val[i] = parseFloat(val);
				//set a current index of Automation Rec
				var currIdx = i;
				if(this.chAM[ch][type].datIdx === null) this.chAM[ch][type].datIdx = i;
		break;
			}
		}
		if(i === len){																															//latest time
			this.chAM[ch][type].time.push(recTime);
			this.chAM[ch][type].val.push(val);
			//set a current index of Automation Rec
			var currIdx = i;
			if(this.chAM[ch][type].datIdx === null) this.chAM[ch][type].datIdx = i;
		}

		/* updata current Index and erase old AM data ----------------------------*/
		var delIdx = i-this.chAM[ch][type].datIdx;
		if(delIdx === 1){																														//sequential input
			this.chAM[ch][type].datIdx = i;
			//console.log('sequential input');
		}else if(delIdx > 1){																												//intermittent input
			var seqIdx = this.chAM[ch][type].datIdx + 1;
			/* Erase old data ------------------------------------------------------*/
			this.chAM[ch][type].time.splice(seqIdx, delIdx-1);
			this.chAM[ch][type].val.splice(seqIdx, delIdx-1);
			this.chAM[ch][type].datIdx = seqIdx;
			//console.log('intermittent input');

		}
		if( (!this.chAM[ch][type].isEditing) && (this.chAM[ch][type].val.length > 1) ){
			if( this.chAM[ch][type].val[ this.chAM[ch][type].datIdx ] === this.chAM[ch][type].val[ this.chAM[ch][type].datIdx-1 ] ){
				//console.log('delete consecutive same value');
				this.chAM[ch][type].time.splice(this.chAM[ch][type].datIdx, 1);
				this.chAM[ch][type].val.splice(this.chAM[ch][type].datIdx, 1);
				--this.chAM[ch][type].datIdx; 
			}
		}
		//console.log(this.chAM[ch][type]);
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Delete Automation Data 
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	deleteAutomationData: function(ch, type, idxDat){
		this.chAM[ch][type].isEditing = true;				//diseable automation play
		this.chAM[ch][type].time.splice(idxDat ,1);
		this.chAM[ch][type].val.splice(idxDat ,1);
		this.chAM[ch][type].datIdx = null;					//reset datIdx
		this.chAM[ch][type].isEditing = false;			//enable automation play
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation Play
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	playAutomation: function(ch){
		var len; 
		for(var i=0; i<this.numTypeAM; i++){																				//i is for Automation Type
			if(this.chAM[ch][i].isEditing || this.chAM[ch][i].isManOp){continue;}			//editing in objTrack
			len = this.chAM[ch][i].time.length;
			if(len === 0) continue;																										//next Automation Type
			for(var j=len-1; j>=0; j--){																							//j is for time
				if(this.chAM[ch][i].time[j] <= playedTime){
					//last index after second time(first time is below this function.)
					if(this.chAM[ch][i].datIdx === j) break;

					//set AM data to WebAudioAPI and html elements
					var val = this.chAM[ch][i].val[j];
					switch(i){
						case this.enum_AM.vol:
							this.playAmVol(ch, val);
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.pan:
							this.playAmPan(ch, val);
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.eqSw:
							this.playAmEqSw(ch, val);
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtSw0:
							this.playAmFiltSw(ch, val, 0);
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtSw1:
							this.playAmFiltSw(ch, val, 1);
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtSw2:
							this.playAmFiltSw(ch, val, 2);
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtSw3:
							this.playAmFiltSw(ch, val, 3);
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtType0:
							this.playAmFiltType(ch, val, 0);
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtType3:
							this.playAmFiltType(ch, val, 3);
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtFreq0:
							this.playAmFiltParam(ch, val, 0, 'freq');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtFreq1:
							this.playAmFiltParam(ch, val, 1, 'freq');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtFreq2:
							this.playAmFiltParam(ch, val, 2, 'freq');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtFreq3:
							this.playAmFiltParam(ch, val, 3, 'freq');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtQ0:
							this.playAmFiltParam(ch, val, 0, 'q');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtQ1:
							this.playAmFiltParam(ch, val, 1, 'q');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtQ2:
							this.playAmFiltParam(ch, val, 2, 'q');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtQ3:
							this.playAmFiltParam(ch, val, 3, 'q');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtGain0:
							this.playAmFiltParam(ch, val, 0, 'gain');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtGain1:
							this.playAmFiltParam(ch, val, 1, 'gain');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtGain2:
							this.playAmFiltParam(ch, val, 2, 'gain');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.filtGain3:
							this.playAmFiltParam(ch, val, 3, 'gain');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.compSw:
							this.playAmCompSw(ch, val);
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.threshold:
							this.playAmCompParam(ch, val, 'threshold');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.knee:
							this.playAmCompParam(ch, val, 'knee');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.ratio:
							this.playAmCompParam(ch, val, 'ratio');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.attack:
							this.playAmCompParam(ch, val, 'attack');
							break;
						/*----------------------------------------------------------------*/
						case this.enum_AM.release:
							this.playAmCompParam(ch, val, 'release');
							break;
					}//EOF switch

					//set last index at first time
					// if(this.chAM[ch][i].datIdx === null && j === len-1) this.chAM[ch][i].datIdx = j;
					if(this.chAM[ch][i].datIdx !== j ) this.chAM[ch][i].datIdx = j;

					break;
				}//EOF if
			}
		}
	},
	/*============================================================================
	Play AM for Volume 
	============================================================================*/
	playAmVol: function(ch, gain){
		//console.log('partCh:'+ch+' gain:'+gain);
		sounds[ch].setGainVal(gain);																								//Web Audio API
		if(ch === this.inspectorCh) objInspector.playAmGainToInspector(gain);				//Inspector
		objMixer.playAmGainToMixer(ch, gain);																				//Mixer
		if(ch === this.fxCh) objFX.playAmGainToFX(gain);														//FX
	},
	/*============================================================================
	Play AM for Pan
	============================================================================*/
	playAmPan: function(ch, pan){
		//console.log('partCh:'+ch+' pan:'+pan);
		sounds[ch].setPanVal(pan);																									//Web Audio API
		if(ch === this.inspectorCh) objInspector.playAmPanToInspector(pan);					//Inspector
		objMixer.playAmPanToMixer(ch, pan);																					//Mixer
		if(ch === this.fxCh) objFX.playAmPanToFX(pan);															//FX
	},
	/*============================================================================
	Play AM for EQ SW
	============================================================================*/
	playAmEqSw: function(ch, numSW){
		//console.log('partCh:'+ch+' numSW:'+numSW);
		if(numSW === 1)      var isOn = true;
		else if(numSW === 0) var isOn = false; 
		var val = sounds[ch].switchEQ(isOn);																				//Web Audio API

		if(ch === this.fxCh){
			objEQ.playAmEqSwToEQ(val);																								//EQ
			objFX.playAmEqSwToFX(val);																								//FX Diagram
		}
	},
	/*============================================================================
	Play AM for Filter SW No.0 - 3
	============================================================================*/
	playAmFiltSw: function(ch, numSW, filterNo){
		if(numSW === 1)      var isOn = true;
		else if(numSW === 0) var isOn = false; 
		var param = sounds[ch].switchFilter(filterNo, isOn);												//Web Audio API
		//console.log(param);

		//EQ & FX Dialog
		if(ch === this.fxCh){
			objEQ.playAmFiltSwToEQ(filterNo, param);																	//EQ
			objFX.playAmFiltSwToFX(filterNo, isOn);																		//FX Diagram
		}
	},
	/*============================================================================
	Play AM for Filter Type No.0 - 3
	============================================================================*/
	playAmFiltType: function(ch, idxFilterType, filterNo){
		sounds[ch].chgFilterType(filterNo, idxFilterType);													//Web Audio API

		//EQ & FX Dialog
		if(ch === this.fxCh){
			var param = sounds[ch].getFilterParam(filterNo);													//get a filter param of filterNo
			objEQ.playAmFiltTypeToEQ(filterNo, idxFilterType, param);									//EQ
			objFX.playAmFiltTypeToFX(filterNo, idxFilterType);												//FX Diagram
		}
	},
	/*============================================================================
	Play AM for Filter Param No.0 - 3
	============================================================================*/
	playAmFiltParam: function(ch, val, filterNo, tgtParam){
		//Web Audio API
		if(tgtParam === 'freq')      sounds[ch].chgFilterFreq(filterNo, val);
		else if(tgtParam === 'q')    sounds[ch].chgFilterQ(filterNo, val);
		else if(tgtParam === 'gain') sounds[ch].chgFilterGain(filterNo, val);

		//EQ
		if(ch === this.fxCh){
			var param = sounds[ch].getFilterParam(filterNo);													//get a filter param of filterNo
			objEQ.playAmFiltParamToEQ(filterNo, param, tgtParam);
		}
	},
	/*============================================================================
	Play AM for Comp SW
	============================================================================*/
	playAmCompSw: function(ch, numSW){
		if(numSW === 1)      var isOn = true;
		else if(numSW === 0) var isOn = false; 
		var val = sounds[ch].switchComp(isOn);																			//Web Audio API

		//Comp & FX
		if(ch === this.fxCh){
			objComp.playAmCompSwToComp(val);																					//Comp
			objFX.playAmCompSwToFX(val);																							//FX Diagram
		}
	},
	/*============================================================================
	Play AM for Comp Param
	============================================================================*/
	playAmCompParam: function(ch, val, typeParam){
		//Web Audio API
		if(typeParam === 'threshold')    sounds[ch].setThreshold(val);
		else if(typeParam === 'knee')    sounds[ch].setKnee(val);
		else if(typeParam === 'ratio')   sounds[ch].setRatio(val);
		else if(typeParam === 'attack')  sounds[ch].setAttack(val);
		else if(typeParam === 'release') sounds[ch].setRelease(val);

		//Comp
		if(ch === this.fxCh){
			if(typeParam === 'threshold') objComp.playAmThresholdToComp(val);
			if(typeParam === 'knee')      objComp.playAmKneeToComp(val);
			if(typeParam === 'ratio')     objComp.playAmRatioToComp(val);
			if(typeParam === 'attack')    objComp.playAmAttackToComp(val);
			if(typeParam === 'release')   objComp.playAmReleaseToComp(val);
		}
	},


	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation Common Proc
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Get Automation Type
	============================================================================*/
	getTypeAM: function(){
		return this.typeAM;
	},
	/*============================================================================
	Get Automation info - min/max values, background color 
	============================================================================*/
	getInfoAM: function(){
		return this.infoAM;
	},
	/*============================================================================
	Get Automation enum - the relation between name and index
	============================================================================*/
	getEnumAM: function(){
		return this.enum_AM;
	},
	/*============================================================================
	Switch Automation Rec
	============================================================================*/
	switchAmRec: function(ch){
		if(this.stateAM[ch] === this.enum_stateAM.rec){															//rec -> stop
			this.stateAM[ch] = this.enum_stateAM.stop;
		}else{																																			//play or stop -> rec 
			if(this.stateAM[ch] === this.enum_stateAM.play){	//stop AM
				this.workerAM[ch].postMessage({'mode':'stop'});
			}
			this.stateAM[ch] = this.enum_stateAM.rec;
		}
		//reset AM data index of a ch
		this.resetAmDatIdx(ch); 
		//check othre ch's rec mode
		this.chkAmRecMode();

		return this.stateAM[ch];
	},
	/*============================================================================
	Switch Automation Play
	============================================================================*/
	switchAmPlay: function(ch){
		if(this.stateAM[ch] === this.enum_stateAM.play){														//play -> stop
			this.workerAM[ch].postMessage({'mode':'stop'});
			this.stateAM[ch] = this.enum_stateAM.stop;
		}else{																																			//rec or stop -> play 
			this.stateAM[ch] = this.enum_stateAM.play;
			this.workerAM[ch].postMessage({'mode':'play', 'ch':ch});									//play AM
		}
		//reset AM data index of a ch
		this.resetAmDatIdx(ch); 
		//check othre ch's rec mode
		this.chkAmRecMode();

		return this.stateAM[ch];
	},
	/*============================================================================
	Reset data index of An Automation type  
	============================================================================*/
	resetDatIdxOfAnAmType: function(ch, idxTypeAM){
		//console.log('resetDatIdxOfAnAmType of objCombProc');
		this.chAM[ch][idxTypeAM].datIdx = null;
	},
	/*============================================================================
	Reset Automation data index
	============================================================================*/
	resetAmDatIdx: function(ch){
		//console.log('ch:'+ch+' @ resetAmDatIdx of objCombProc');
		for(var i=0; i<this.numTypeAM; i++){
			this.chAM[ch][i].datIdx = null;
		}
	},
	/*============================================================================
	Reset all automation data index 
	===========================================
	=================================*/
	resetAllAmDatIdx: function(){
		//console.log('resetAllAmDatIdx of objCmbProc');
		for(var i=0; i<this.numPartCh; i++){																				//Part Ch
			for(var j=0; j<this.numTypeAM; j++){																			//AM type
				//console.log('i:'+i+' j:'+j);
				this.chAM[i][j].datIdx = null;
			}
		}
	},
	/*============================================================================
	Check Automation Rec mode
	============================================================================*/
	chkAmRecMode: function(){
		//console.log('check AM rec mode @ chkAmRecMode of objCmbProc');
		for(var i=0; i<this.numPartCh; i++){
			if(this.stateAM[i] === this.enum_stateAM.rec){
				this.isAmRec = true;
				return;
			}
		}
		this.isAmRec = false;
	},
	/*============================================================================
	Get Automation Data
	============================================================================*/
	getAmDat: function(idxCh, idxTypeAM){
		return this.chAM[idxCh][idxTypeAM];
	},
	/*============================================================================
	Set isManOp
	============================================================================*/
	setIsManOp: function(srcObj, idxCh, idxTypeAM, isManOp){
		switch(srcObj){
			case this.actSrc.inspector:
				idxCh = this.inspectorCh;
				break;
			case this.actSrc.fx:
			case this.actSrc.eq:
			case this.actSrc.comp:
				if(this.fxCh !== this.idxOutputCh) idxCh = this.fxCh;		//for part Ch.
				else return;																						//output Ch doesn't have Automation data. 
				break;
		};

		this.chAM[idxCh][idxTypeAM].isManOp = isManOp;
		//console.log(this.chAM[idxCh][idxTypeAM].isManOp);
	},


	/*****************************************************************************
	from Transpose
	*****************************************************************************/
	/*============================================================================
	Move start position from transpose
	============================================================================*/
	moveStartPosFromTranspose: function(){
		playedTime = 0;															//set 0 sec 
		objTrack.setPlayLinePos(playedTime);				//set Play 'LINE' on Track

		/* Playing ---------------------------------------------------------------*/
		this.cmnProcChgPtOnPlaying();
	},
	/*============================================================================
	Play Order  
	============================================================================*/
	playOrderFromTranspose: function(){
		switch(state){
			case enum_states.loading:
				return false;
				break;
			case enum_states.play:
			case enum_states.chgPlayPos:
				return true;								//for click play button(canvas) in playing
				break;
			case enum_states.stop:
				this.playAudio();	//start sounds
				return true;
				break;
		};
	},
	/*============================================================================
	Play Audio
	============================================================================*/
	playAudio: function(){
		offsetTime = playedTime;								//current played time is offset time.
		this.returnTime = playedTime;						//stopping audio uses this time in return mode.
		startTime = context.currentTime + 0.5;
		for(var i=0; i<this.numPartCh; i++){
			sounds[i].play();											//each audio playback
		}
		worker.postMessage('start');						//start interval process by Worker
		state = enum_states.play;								//state: now playing
	},
	/*============================================================================
	Stop Order  
	============================================================================*/
	stopOrderFromTranspose: function(){
		if(state === enum_states.play) this.stopAudio();	//stop sounds
	},
	/*============================================================================
	Stop sounds
	============================================================================*/
	stopAudio: function(optmsg){
		switch (optmsg) {
			case 'reStart':
				state = enum_states.chgPlayPos;	//state: restart at changed play positon while playback
				break;
			default:
				state = enum_states.stop;				//state: stop playback
				break;
		}
		worker.postMessage('stop');						//stop an interval Worker process
		for(var i=0; i<this.numPartCh; i++){
			sounds[i].stop();										//stop each audio
		}
		if(this.isReturn && state === enum_states.stop){	//in Return Mode
			playedTime = this.returnTime;										//set playdTime as return time
			objTranspose.setPlayedTime(this.returnTime);
			objTrack.setPlayLinePos(this.returnTime);
		}
	},
	/*============================================================================
	Check All Sounds Stop
	============================================================================*/
	isStoppedAllSounds: function(){
		//console.log('called isStoppedAllSounds @ objCombProc');
		for(var i=0; i<this.numPartCh; i++){
			if(sounds[i].isPlayAudio) return false;
		}
		return true;
	},
	/*============================================================================
	set Return State From Transpose
	============================================================================*/
	setReturnStateFromTranspose: function(){
		this.isReturn = !this.isReturn;
		return this.isReturn;
	},
	/*============================================================================
	Set Repeat State From Transpose
	============================================================================*/
	setRepeatStateFromTranspose: function(){
		//console.log('Change repeat status @ setRepeatStatus of objCombProc');
		this.isRepeat = !this.isRepeat;
		objTrack.setRepeatMode(this.isRepeat);
		return this.isRepeat;
	},
	/*============================================================================
	Start Played Time Changing from Transpose 
	============================================================================*/
	startPtChgFromTranspose: function(){
		//console.log('isPlayedTimeChg: ' + this.isPlayedTimeChg + ' @ startPtChgFromTranspose of objCombProc')
		this.isPlayedTimeChg = true;
	},
	/*============================================================================
	Changing Played Time from Transpose
	============================================================================*/
	chgingPtFromTranspose: function(timeVal){
		//console.log('changing played time is ' + timeVal + ' @ chgingPt of objCombProc');
		if(state === enum_states.stop){
			playedTime = timeVal;
			objTrack.setPlayLinePos(playedTime);		//set Play 'LINE' on Track
		}
	},
	/*============================================================================
	End Played Time Change from Transpose 
	============================================================================*/
	endPtChgFromTranspose: function(timeVal){
		// console.log('changed played time is ' + timeVal + ' endPlayedTimeChgFromTranpose @ objCombProc');
		if(state === enum_states.play){
			playedTime = timeVal;																											//set played Time
			this.cmnProcChgPtOnPlaying();																							//Common proc for change Played Time
		}
		this.isPlayedTimeChg = false;
	},
	/*============================================================================
	Changing Repeat Start Time from Transpose
	============================================================================*/
	chgingRSTfromTranspose: function(timeVal){
		//console.log('Repeat start time: ' + timeVal + ' chgingRSTfromTranspose of objCombProc');
		this.repeatStartTime = timeVal;	//update repeat start time
		this.chkAvailableRepeat();
		objTrack.setRepeatStartTimeToTrack(timeVal);
	},
	/*============================================================================
	Changing Repeat End Time from Transpose
	============================================================================*/
	chgingRETfromTranspose: function(timeVal){
		//console.log('Repeat end time: ' + timeVal + ' chgingRETfromTranspose of objCombProc');
		this.repeatEndTime = timeVal;	//update repeat end time
		this.chkAvailableRepeat();
		objTrack.setRepeatEndTimeToTrack(timeVal);
	},
	/*============================================================================
	Set Repeat Part from Transpose
	============================================================================*/
	setRptPartFromTranspose: function(idxPart){
		this.repeatStartTime = this.startPartSec[idxPart];
		this.repeatEndTime = this.startPartSec[idxPart+1];
		this.chkAvailableRepeat();
		objTrack.setRepeatStartTimeToTrack(this.repeatStartTime);
		objTrack.setRepeatEndTimeToTrack(this.repeatEndTime);
		return {
			stTime:  this.repeatStartTime,
			endTime: this.repeatEndTime,
		}
	},



	/*****************************************************************************
	common proc from Transpose, Inspector, Track, Mixer, FX
	*****************************************************************************/
	/*============================================================================
	Switch display mode
	============================================================================*/
	switchDispMode: function(dispMode){
		switch(dispMode){
			case 'Track':
				this.e_divTrack.style.display = 'block';
				this.e_divMixer.style.display = 'none';
				this.e_divFX.style.display = 'none';
				break;
			case 'Mixer':
				this.e_divTrack.style.display = 'none';
				this.e_divMixer.style.display = 'block';
				this.e_divFX.style.display = 'none';
				break;
			case 'FX':
				this.e_divTrack.style.display = 'none';
				this.e_divMixer.style.display = 'none';
				this.e_divFX.style.display = 'block';
				break;
		};
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Output Ch
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Set Pan value (Output ch)  
	============================================================================*/
	setOutputPanFromMF: function(srcObj, pan){
		sounds[this.idxOutputCh].setPanVal(pan);
		//Linkage proc
		switch(srcObj){
			case this.actSrc.mixer:
				if(this.fxCh === this.idxOutputCh) objFX.setPanToFX(pan);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.fx:
				objMixer.setOutputPanToMixer(pan);
				break;
		};

	},
	/*============================================================================
	Set Gain value (Output ch)
	============================================================================*/
	setOutputGainFromMF: function(srcObj, gain){
		sounds[this.idxOutputCh].setGainVal(gain);
		
		//Linkage proc
		switch(srcObj){
			case this.actSrc.mixer:
				if(this.fxCh === this.idxOutputCh) objFX.setGainToFX(gain);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.fx:
				objMixer.setOutputGainToMixer(gain);
				break;
		};

	},
	/*============================================================================
	Mute on/off (Output Ch)
	============================================================================*/
	switchOutputMuteFromMF: function(srcObj){
		if(sounds[this.idxOutputCh].getChMode() !== 'mute'){
			sounds[this.idxOutputCh].switchMute();
			sounds[this.idxOutputCh].turnOnOffNodeGain(false);	//mute ch. disenable output
			var chMode = 'mute';
		}else{
			sounds[this.idxOutputCh].switchNorm();
			sounds[this.idxOutputCh].turnOnOffNodeGain(true);		//solo or normal ch. enable output
			var chMode = 'norm';
		}

		//Linkage proc
		switch(srcObj){
			case this.actSrc.mixer:
				if(this.fxCh === this.idxOutputCh) objFX.setBtnColorForMuteToFX(chMode);
				return chMode;
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.fx:
				objMixer.setBtnColorForOutputMuteToMixer(chMode);
				return chMode;
				break;
		};
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Part Ch
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Set Pan value (Part Ch)
	============================================================================*/
	setPanFromITMF: function(srcObj, idxCh, pan){
		if(srcObj === this.actSrc.inspector) idxCh = this.inspectorCh;
		else if(srcObj === this.actSrc.fx)   idxCh = this.fxCh;
		sounds[idxCh].setPanVal(pan);

		//Automation Rec
		if(this.stateAM[idxCh] === this.enum_stateAM.rec){													//Automation state:Rec
			this.recAutomation(idxCh, this.enum_AM.pan, parseFloat(playedTime.toFixed(3)), pan);
			objTrack.drawingAmDatToTrack(idxCh, this.enum_AM.pan);										//Drawing AM Dat in a Tr
		}

		//linkaging proc
		switch(srcObj){
			case this.actSrc.inspector:
				objMixer.setPanToMixer(idxCh, pan);
				if(idxCh === this.fxCh) objFX.setPanToFX(pan);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.mixer:
				if(idxCh === this.inspectorCh) objInspector.setPanToInpsector(pan);
				if(idxCh === this.fxCh) objFX.setPanToFX(pan);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.fx:
				objMixer.setPanToMixer(idxCh, pan);
				if(idxCh === this.inspectorCh) objInspector.setPanToInpsector(pan);
				break;
		};
	},
	/*============================================================================
	Set Gain value (Part Ch)
	============================================================================*/
	setGainFromITMF: function(srcObj, idxCh, gain){
		//Set Gain value
		if(srcObj === this.actSrc.inspector) idxCh = this.inspectorCh;
		else if(srcObj === this.actSrc.fx)   idxCh = this.fxCh;
		sounds[idxCh].setGainVal(gain);

		//Automation Rec
		if(this.stateAM[idxCh] === this.enum_stateAM.rec){													//Automation state:Rec
			this.recAutomation(idxCh, this.enum_AM.vol, parseFloat(playedTime.toFixed(3)), gain);
			objTrack.drawingAmDatToTrack(idxCh, this.enum_AM.vol);										//Drawing AM Dat in a Tr
		}

		//linkaging proc
		switch(srcObj){
			case this.actSrc.inspector:
				objMixer.setGainToMixer(idxCh, gain);
				if(idxCh === this.fxCh) objFX.setGainToFX(gain);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.mixer:
				if(idxCh === this.inspectorCh) objInspector.setGainToInpsector(gain);
				if(idxCh === this.fxCh) objFX.setGainToFX(gain);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.fx:
				objMixer.setGainToMixer(idxCh, gain);
				if(idxCh === this.inspectorCh) objInspector.setGainToInpsector(gain);
				break;
		};
	},
	/*============================================================================
	Mute on/off (Part Ch)
	============================================================================*/
	switchMuteFromITMF: function(srcObj, idxCh){
		if(srcObj === this.actSrc.inspector) idxCh = this.inspectorCh;
		else if(srcObj === this.actSrc.fx)   idxCh = this.fxCh;

		if(sounds[idxCh].getChMode() !== 'mute'){				//ch mode: norm or solo -> mute
			sounds[idxCh].switchMute();
			sounds[idxCh].turnOnOffNodeGain(false);				//mute ch. disenable output
			var retMode = 'mute';
			// return 'mute';
		}else{																					//ch mode: mute -> solo or normal
			sounds[idxCh].turnOnOffNodeGain(true);				//solo or normal ch. enable output
			for(var i=0, len=this.numPartCh; i<len; i++){	//check other ch in solo mode or not
				if(sounds[i].getChMode() === 'solo'){
					sounds[idxCh].switchSolo();
					// return 'solo';
					var retMode = 'solo';
					break;
				}
			}
			// sounds[idxCh].switchNorm();
			// return 'norm';
			if(i === len){
				sounds[idxCh].switchNorm();
				var retMode = 'norm';
			}
		}

		//linkaging proc
		var isMS = this.getMuteSoloOfPartChToSound();																// Mute / Solo in Part Ch.
		objTrack.setBtnColorAllPartChMuteSoloState(isMS.mute, isMS.solo);

		switch(srcObj){
			case this.actSrc.inspector:
				objTrack.setBtnColorForMuteToTrack(idxCh, retMode);
				objMixer.setBtnColorForMuteToMixer(idxCh, retMode);
				if(idxCh === this.fxCh) objFX.setBtnColorForMuteToFX(retMode);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.track:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForMuteToInspector(retMode);
				objMixer.setBtnColorForMuteToMixer(idxCh, retMode);
				if(idxCh === this.fxCh) objFX.setBtnColorForMuteToFX(retMode);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.mixer:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForMuteToInspector(retMode);
				objTrack.setBtnColorForMuteToTrack(idxCh, retMode);
				if(idxCh === this.fxCh) objFX.setBtnColorForMuteToFX(retMode);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.fx:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForMuteToInspector(retMode);
				objTrack.setBtnColorForMuteToTrack(idxCh, retMode);
				objMixer.setBtnColorForMuteToMixer(idxCh, retMode);
				break;
		};

		return retMode;
	},
	/*============================================================================
	Solo on/off (Part Ch)
	============================================================================*/
	switchSoloFromITMF: function(srcObj, idxCh){
		if(srcObj === this.actSrc.inspector) idxCh = this.inspectorCh;
		else if(srcObj === this.actSrc.fx)   idxCh = this.fxCh;

		if(sounds[idxCh].getChMode() !== 'solo'){	//ch mode: normal or mute -> solo
			sounds[idxCh].switchSolo();
		}else{																	//ch mode: solo -> Normal(temporary)
			sounds[idxCh].switchNorm();
		}
		chModes = new Array(this.numPartCh);
		var isSoloCh = false;
		//Check solo mode ch
		for(var i=0; i<this.numPartCh; i++){
			if(sounds[i].getChMode() === 'solo'){
				isSoloCh = true;
				chModes[i] = 'solo';								//ch mode: solo
				sounds[i].turnOnOffNodeGain(true);	//solo ch. enable output
			}else{
				chModes[i] = '';										//normal or mute - unknown mode
			}
		}
		//set mute or normal mode for unknown ch
		if(isSoloCh){																				//any ch in Solo
			for(var i=0, len=chModes.length; i<len; i++){
				if(chModes[i] === 'solo') continue;
				chModes[i] = 'mute';								//ch mode: mute
				sounds[i].switchMute();							//mute mode
				sounds[i].turnOnOffNodeGain(false);	//disable output
			}
		}else{																							//all chs in no-solo
			for(var i=0, len=chModes.length; i<len; i++){
				chModes[i] = 'norm';								//ch mode: normal
				sounds[i].switchNorm();							//norm mode
				sounds[i].turnOnOffNodeGain(true);	//enable output
			}
		}

		//Linkage process
		var isMS = this.getMuteSoloOfPartChToSound();	// Mute / Solo in Part Ch.
		objTrack.setBtnColorAllPartChMuteSoloState(isMS.mute, isMS.solo);

		switch(srcObj){
			case this.actSrc.inspector:
				objTrack.setBtnColorForSoloToTrack(chModes);
				objMixer.setBtnColorForSoloToMixer(chModes);
				if(idxCh === this.fxCh) objFX.setBtnColorForSoloToFX(chModes[idxCh]);
				return chModes[idxCh];
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.track:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForSoloToInspector(chModes[idxCh]);
				objMixer.setBtnColorForSoloToMixer(chModes);
				if(idxCh === this.fxCh) objFX.setBtnColorForSoloToFX(chModes[idxCh]);
				return chModes;
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.mixer:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForSoloToInspector(chModes[idxCh]);
				objTrack.setBtnColorForSoloToTrack(chModes);
				if(idxCh === this.fxCh) objFX.setBtnColorForSoloToFX(chModes[idxCh]);
				return chModes;
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.fx:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForSoloToInspector(chModes[idxCh]);
				objTrack.setBtnColorForSoloToTrack(chModes);
				objMixer.setBtnColorForSoloToMixer(chModes);
				return chModes[idxCh];
				break;
		};
	},
	/*============================================================================
	Automation:Rec (Part Ch)
	============================================================================*/
	switchAmRecFromITMF: function(srcObj, idxCh){
		if(srcObj === this.actSrc.inspector) idxCh = this.inspectorCh;
		else if(srcObj === this.actSrc.fx)   idxCh = this.fxCh;

		var chMode = this.switchAmRec(idxCh);

		//Linkage process
		switch(srcObj){
			case this.actSrc.inspector:
				objTrack.setBtnColorForRecAmToTrack(idxCh, chMode);
				objMixer.setBtnColorForRecAmToMixer(idxCh, chMode);
				if(idxCh === this.fxCh) objFX.setBtnColorForRecAmToFX(chMode);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.track:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForRecAmToInspector(chMode);
				objMixer.setBtnColorForRecAmToMixer(idxCh, chMode);
				if(idxCh === this.fxCh) objFX.setBtnColorForRecAmToFX(chMode);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.mixer:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForRecAmToInspector(chMode);
				objTrack.setBtnColorForRecAmToTrack(idxCh, chMode);
				if(idxCh === this.fxCh) objFX.setBtnColorForRecAmToFX(chMode);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.fx:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForRecAmToInspector(chMode);
				objTrack.setBtnColorForRecAmToTrack(idxCh, chMode);
				objMixer.setBtnColorForRecAmToMixer(idxCh, chMode);
				break;
		};

		return chMode;
	},
	/*============================================================================
	Automation:Play (Part Ch)
	============================================================================*/
	switchAmPlayFromITMF: function(srcObj, idxCh){
		if(srcObj === this.actSrc.inspector) idxCh = this.inspectorCh;
		else if(srcObj === this.actSrc.fx)   idxCh = this.fxCh;

		var chMode  = this.switchAmPlay(idxCh);

		//Linkage process
		switch(srcObj){
			case this.actSrc.inspector:
				objTrack.setBtnColorForPlayAmToTrack(idxCh, chMode);
				objMixer.setBtnColorForPlayAmToMixer(idxCh, chMode);
				if(idxCh === this.fxCh) objFX.setBtnColorForPlayAmToFX(chMode);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.track:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForPlayAmToInspector(chMode);
				objMixer.setBtnColorForPlayAmToMixer(idxCh, chMode);
				if(idxCh === this.fxCh) objFX.setBtnColorForPlayAmToFX(chMode);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.mixer:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForPlayAmToInspector(chMode);
				objTrack.setBtnColorForPlayAmToTrack(idxCh, chMode);
				if(idxCh === this.fxCh) objFX.setBtnColorForPlayAmToFX(chMode);
				break;
			/*----------------------------------------------------------------------*/
			case this.actSrc.fx:
				if(idxCh === this.inspectorCh) objInspector.setBtnColorForPlayAmToInspector(chMode);
				objTrack.setBtnColorForPlayAmToTrack(idxCh, chMode);
				objMixer.setBtnColorForPlayAmToMixer(idxCh, chMode);
				break;
		};

		return chMode;
	},
	/*============================================================================
	e(Effect) - change Mode from  Inspector, Track and Mixer to FX, EQ and Comp  
	============================================================================*/
	switchEffectFromITMF: function(srcObj, idxCh){
		if(srcObj === this.actSrc.inspector) idxCh = this.inspectorCh;
		this.fxCh = idxCh;																							//update current Ch.

		//console - pan, gain, chMode, stateAM
		var panGainChMode = sounds[idxCh].getPanGainChMode();						//Pan, Gain, chMode
		if(idxCh === this.outputCh) var stateAM = null;									//state of Automation
		else                        var stateAM = this.stateAM[idxCh];
		var csl = {
			pan:      panGainChMode.pan,
			gain:     panGainChMode.gain, 
			chMode:   panGainChMode.chMode,
			chModeAM: stateAM,
		};

		// EQ, comp param
		var allEqParam = this.getAllEqParamOfCurrCh();
		var allCompParam = this.getCompAllParams();

		//Set param
		objEQ.setFilterParamOfCurrChToEQ(allEqParam);																//EQ
		objComp.setParamOfCurrChToComp(allCompParam);																//Comp
		objFX.setEqCompParamToDialog({EQ: allEqParam, Comp: allCompParam});					//Dialog in FX
		objFX.setFxChParam(this.fxCh, csl);																					//set Ch. name / icon 

		//swich display mode
		if(srcObj !== this.actSrc.fx) this.switchDispMode('FX');
	},



	/*****************************************************************************
	from Track
	*****************************************************************************/
	/*============================================================================
	Set Inspector's Ch 
	============================================================================*/
	setInspectorChFromTrack: function(idxCh){
		//Set current inspector's Ch
		this.inspectorCh = idxCh;

		//Get param for inspector
		var p = this.getPanGainChModeFromSounds(this.actSrc.track, idxCh);

		//Set param to Inspector
		objInspector.setPanGainChModeToInspector(p.pan, p.gain, p.chMode, p.stateAM, p.imgSrc, p.trColor, p.trName);
	},
	/*============================================================================
	Set Play positon
	============================================================================*/
	setPlayPosFromTrack: function(playPos){
		//console.log('playPos:' + playPos + ' @ setPlayPosFromTrack of objCombProc');
		playedTime = playPos;
		//for repeat process
		if(playPos > this.repeatEndTime) this.isOverRepeatEndTime = true;
		else this.isOverRepeatEndTime = false;
		//set Play Time
		objTranspose.setPlayedTime(playPos);

		//console.log('isOverRepeatEndTime:' + this.isOverRepeatEndTime + ' @ setPlayPosFromTrack of objCombProc');

		this.cmnProcChgPtOnPlaying();																								//Common Proc for change Played Time
	},
	/*============================================================================
	Change repeat start time
	============================================================================*/
	setRepeatStartTimeFromTrack: function(repeatStartTime){
		this.repeatStartTime = repeatStartTime;
		this.chkAvailableRepeat();
		objTranspose.setRepeatStartTime(this.repeatStartTime);
		//console.log('repeat start time:' + this.repeatStartTime + ' @ setRepeatStartTimeFromTrack of objCombProc');
	},
	/*============================================================================
	Change repeat end time
	============================================================================*/
	setRepeatEndTimeFromTrack: function(repeatEndTime){
		this.repeatEndTime = repeatEndTime;
		this.chkAvailableRepeat();
		objTranspose.setRepeatEndTime(this.repeatEndTime);
		//console.log('repeat end time:' + this.repeatEndTime + '@ setRepeatEndTimeFromTrack of objCombProc');
	},
	/*============================================================================
	Change repeat status: valid or not
	============================================================================*/
	setRepeatRegionFromTrack: function(rptStartTime, rptEndTime){
		this.repeatStartTime = rptStartTime;	//change this line later date
		this.repeatEndTime = rptEndTime;
		this.chkAvailableRepeat();
		objTranspose.setRepeatStartTime(this.repeatStartTime);
		objTranspose.setRepeatEndTime(this.repeatEndTime);
	},
	/*============================================================================
	Set All Part Ch In Norm mode from Track
	============================================================================*/
	setAllPartChInNrmModeFromTrack: function(){
		for(var i=0; i<this.numPartCh; i++){
			sounds[i].switchNorm();
			sounds[i].turnOnOffNodeGain(true);
		}

		//Linkage proc
		objInspector.setBtnColorForNormToInspector();																//Inspector
		objTrack.setBtnColorAllPartChForNormToTrack();															//Track
		objMixer.setBtnColorAllPartChForNormToMixer();															//Mixer
		if(this.fxCh !== this.outputCh) objFX.setBtnColorForMuteToFX('norm');				//FX
	},


	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Automation from Track
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Seek a target automation data
	============================================================================*/
	seekTgtAmDatFromTrack: function(ch, idxTypeAM, amTime, margine){
		//console.log('seekTgtAmDat of objCombProc');
		var len = this.chAM[ch][idxTypeAM].time.length;
		if(len === 0) return null;

		for(var i=0; i<len; i++){
			if( (this.chAM[ch][idxTypeAM].time[i]-margine <= amTime) && (amTime <= this.chAM[ch][idxTypeAM].time[i]+margine) ){
				// console.log('found!');
				break;
			}
		}
		if(i === len) return { tgtIdx:null, chAM:this.chAM[ch][idxTypeAM] };
		else          return { tgtIdx: i,   chAM:this.chAM[ch][idxTypeAM] };
	},
	/*============================================================================
	delete Automation data
	============================================================================*/
	delAmDatFromTrack: function(ch, idxTypeAM, recTime, margine){
		//console.log('delAmDatFromTrack of objCombProc');
		len = this.chAM[ch][idxTypeAM].val.length;
		//search tgt data
		for(var i=0; i<len; i++){
			if( (recTime-margine <= this.chAM[ch][idxTypeAM].time[i]) && (this.chAM[ch][idxTypeAM].time[i] <= recTime+margine) ){
				this.deleteAutomationData(ch, idxTypeAM, i);
				// console.log('found delete data!');
				break;
			}
		}
		return this.chAM[ch][idxTypeAM];
	},
	/*============================================================================
	set Automation data
	============================================================================*/
	setAmDataFromTrack: function(ch, idxTypeAM, recTime, datAM){
		this.chAM[ch][idxTypeAM].isEditing = true;					//diseable atutomation play
		this.resetDatIdxOfAnAmType(ch, idxTypeAM);					//for add automation data
		this.recAutomation(ch, idxTypeAM, recTime, datAM);	//Automation Rec
		this.chAM[ch][idxTypeAM].isEditing = false;					//enaable atutomation play
		return this.chAM[ch][idxTypeAM];
	},
	/*============================================================================
	delete & add Automation data
	============================================================================*/
	delAndAddAmDatFromTrack: function(ch, idxTypeAM, delIdx, recTime, datAM){
		//console.log('delIdx:' + delIdx + ' recTime: ' + recTime + ' datAM: ' + datAM);
		//delete Automation data
		this.deleteAutomationData(ch, idxTypeAM, delIdx);
		//add automation data
		return this.setAmDataFromTrack(ch, idxTypeAM, recTime, datAM);
	},



	/*****************************************************************************
	from Mixer
	*****************************************************************************/
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Icon Select
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Set Auto Display Position Mix Icon
	============================================================================*/
	setAutoDispPosMixIconFromMixer: function(){
		this.isAutoDispPosMixIcon = !this.isAutoDispPosMixIcon;
		return this.isAutoDispPosMixIcon;
	},
	/*============================================================================
	disable Auto Display Position Mix Icon
	============================================================================*/
	disableAutoDispPosMixIconFromMixer: function(){
		this.isAutoDispPosMixIcon = false;
	},



	/*****************************************************************************
	from EQ 
	*****************************************************************************/
	/*============================================================================
	Get Anaylyser node for EQ spectrum 
	============================================================================*/
	getAnalyzerNode: function(){
			return sounds[this.fxCh].getAnalyserNode();
	},
	/*============================================================================
	Get Filter type
	============================================================================*/
	getFilterTypeIdx: function(filterNo){
		return sounds[this.fxCh].getFilterTypeIdx(filterNo);
	},
	/*============================================================================
	Switch EQ (FX ON/OFF) 
	============================================================================*/
	switchFxFromEQ: function(){
		var isOn = sounds[this.fxCh].switchEQ(null); 
		objFX.swEqModeToFX(isOn);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			if(isOn) var numSW = this.enum_swAM.on;
			else var numSW = this.enum_swAM.off;
			// this.recAutomation(this.fxCh, this.enum_AM.eqSw, parseFloat(playedTime.toFixed(3)), isOn);
			this.recAutomation(this.fxCh, this.enum_AM.eqSw, parseFloat(playedTime.toFixed(3)), numSW);
			objTrack.drawingAmDatToTrack(this.fxCh, this.enum_AM.eqSw);								//Drawing AM Dat in a Tr
		}
		return isOn;
	},
	/*============================================================================
	Get All EQ param selected Ch from sounds()
	============================================================================*/
	getAllEqParamOfCurrCh: function(){
		return sounds[this.fxCh].getEqParam();
	},
	/*============================================================================
	Get Aasigned filter param selected Ch from sounds()
	============================================================================*/
	getFilterParamFromEQ: function(filterNo){
		return sounds[this.fxCh].getFilterParam(filterNo);
	},
	/*============================================================================
	 Filter SW ON/OFF 
	============================================================================*/
	switchFilterFromEQ: function(filterNo){
		var filterParam = sounds[this.fxCh].switchFilter(filterNo, null);

		//FX Diagram
		if(filterParam === null) var isOn = false;
		else                     var isOn = true;
		objFX.swFilterToFX(filterNo, isOn);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			//set index of am type
			if(filterNo === 0)      var typeAM = this.enum_AM.filtSw0;
			else if(filterNo === 1) var typeAM = this.enum_AM.filtSw1;
			else if(filterNo === 2) var typeAM = this.enum_AM.filtSw2;
			else if(filterNo === 3) var typeAM = this.enum_AM.filtSw3;
			//set a number for a filter sw
			if(isOn) var numSW = this.enum_swAM.on;
			else var numSW = this.enum_swAM.off;
			// this.recAutomation(this.fxCh, typeAM, parseFloat(playedTime.toFixed(3)), isOn);
			this.recAutomation(this.fxCh, typeAM, parseFloat(playedTime.toFixed(3)), numSW);
			objTrack.drawingAmDatToTrack(this.fxCh, typeAM);													//Drawing AM Dat in a Tr
		}

		return filterParam;
	},
	/*============================================================================
	Filter type change
	============================================================================*/
	setFilterTypeFromEQ(filterNo, idxType){
		sounds[this.fxCh].chgFilterType(filterNo, idxType);

		//FX Diagram
		objFX.chgFilterType(filterNo, this.filterNames[idxType]);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			if(filterNo === 0)      var typeAM = this.enum_AM.filtType0;
			else if(filterNo === 3) var typeAM = this.enum_AM.filtType3;
			this.recAutomation(this.fxCh, typeAM, parseFloat(playedTime.toFixed(3)), parseInt(idxType));
			objTrack.drawingAmDatToTrack(this.fxCh, typeAM);													//Drawing AM Dat in a Tr
		}
	},
	/*============================================================================
	frequency change
	============================================================================*/
	setFreqFromEQ(filterNo, freq){
		sounds[this.fxCh].chgFilterFreq(filterNo, freq);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			if(filterNo === 0)      var typeAM = this.enum_AM.filtFreq0;
			else if(filterNo === 1) var typeAM = this.enum_AM.filtFreq1;
			else if(filterNo === 2) var typeAM = this.enum_AM.filtFreq2;
			else if(filterNo === 3) var typeAM = this.enum_AM.filtFreq3;
			this.recAutomation(this.fxCh, typeAM, parseFloat(playedTime.toFixed(3)), parseFloat(freq));
			objTrack.drawingAmDatToTrack(this.fxCh, typeAM);													//Drawing AM Dat in a Tr
		}
	},
	/*============================================================================
	Q change
	============================================================================*/
	setQFromEQ(filterNo, q){
		sounds[this.fxCh].chgFilterQ(filterNo, q);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			if(filterNo === 0)      var typeAM = this.enum_AM.filtQ0;
			else if(filterNo === 1) var typeAM = this.enum_AM.filtQ1;
			else if(filterNo === 2) var typeAM = this.enum_AM.filtQ2;
			else if(filterNo === 3) var typeAM = this.enum_AM.filtQ3;
			this.recAutomation(this.fxCh, typeAM, parseFloat(playedTime.toFixed(3)), parseFloat(q));
			objTrack.drawingAmDatToTrack(this.fxCh, typeAM);													//Drawing AM Dat in a Tr
		}
	},
	/*============================================================================
	gain change
	============================================================================*/
	setGainFromEQ(filterNo, gain){
		sounds[this.fxCh].chgFilterGain(filterNo, gain);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			if(filterNo === 0)      var typeAM = this.enum_AM.filtGain0;
			else if(filterNo === 1) var typeAM = this.enum_AM.filtGain1;
			else if(filterNo === 2) var typeAM = this.enum_AM.filtGain2;
			else if(filterNo === 3) var typeAM = this.enum_AM.filtGain3;
			this.recAutomation(this.fxCh, typeAM, parseFloat(playedTime.toFixed(3)), parseFloat(gain));
			objTrack.drawingAmDatToTrack(this.fxCh, typeAM);													//Drawing AM Dat in a Tr
		}
	},


	/*****************************************************************************
	From Compressor
	*****************************************************************************/
	/*============================================================================
	Get Compressor All Paramators
	============================================================================*/
	getCompAllParams(){
		return sounds[this.fxCh].getCompAllParams();
	},
	/*============================================================================
	Switch a compressor ON/OFf
	============================================================================*/
	switchComp(){
		var isOn = sounds[this.fxCh].switchComp(null);
		objFX.swCompModeToFX(isOn);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			if(isOn) var numSW = this.enum_swAM.on;
			else var numSW = this.enum_swAM.off;
			// this.recAutomation(this.fxCh, this.enum_AM.compSw, parseFloat(playedTime.toFixed(3)), isOn);
			this.recAutomation(this.fxCh, this.enum_AM.compSw, parseFloat(playedTime.toFixed(3)), numSW);
			objTrack.drawingAmDatToTrack(this.fxCh, this.enum_AM.compSw);							//Drawing AM Dat in a Tr
		}

		return isOn;
	},
	/*============================================================================
	Set Threshold value 
	============================================================================*/
	setThreshold(threshold){
		sounds[this.fxCh].setThreshold(threshold);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			this.recAutomation(this.fxCh, this.enum_AM.threshold, parseFloat(playedTime.toFixed(3)), parseFloat(threshold));
			objTrack.drawingAmDatToTrack(this.fxCh, this.enum_AM.threshold);					//Drawing AM Dat in a Tr
		}
	},
	/*============================================================================
	Set Knee value 
	============================================================================*/
	setKnee(knee){
		sounds[this.fxCh].setKnee(knee);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			this.recAutomation(this.fxCh, this.enum_AM.knee, parseFloat(playedTime.toFixed(3)), parseFloat(knee));
			objTrack.drawingAmDatToTrack(this.fxCh, this.enum_AM.knee);								//Drawing AM Dat in a Tr
		}
	},
	/*============================================================================
	Set Ratio value 
	============================================================================*/
	setRatio(ratio){
		sounds[this.fxCh].setRatio(ratio);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			this.recAutomation(this.fxCh, this.enum_AM.ratio, parseFloat(playedTime.toFixed(3)), parseFloat(ratio));
			objTrack.drawingAmDatToTrack(this.fxCh, this.enum_AM.ratio);							//Drawing AM Dat in a Tr
		}
	},
	/*============================================================================
	Set Attack value 
	============================================================================*/
	setAttack(attack){
		sounds[this.fxCh].setAttack(attack);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			this.recAutomation(this.fxCh, this.enum_AM.attack, parseFloat(playedTime.toFixed(3)), parseFloat(attack));
			objTrack.drawingAmDatToTrack(this.fxCh, this.enum_AM.attack);							//Drawing AM Dat in a Tr
		}
	},
	/*============================================================================
	Set Release value 
	============================================================================*/
	setRelease(release){
		sounds[this.fxCh].setRelease(release);

		//Automation Rec
		if( (this.fxCh !== this.idxOutputCh) && (this.stateAM[this.fxCh] === this.enum_stateAM.rec) ){	//Automation state:Rec
			this.recAutomation(this.fxCh, this.enum_AM.release, parseFloat(playedTime.toFixed(3)), parseFloat(release));
			objTrack.drawingAmDatToTrack(this.fxCh, this.enum_AM.release);						//Drawing AM Dat in a Tr
		}
	},
}; //EOF objCombProc


/*******************************************************************************
Navigation
*******************************************************************************/
var isNavi = true; //Notice this is a global value! / true: eanble navigation

var objNavi = {
	/* Menu --------------------------------------------------------------------*/

	/* Quick Navi --------------------------------------------------------------*/
	e_divMsg: null,
	e_spnQnaviMsg: null,

	//message
	navType: {
		//Transpose ----------------------------------------------------------------
		tpPlayMrk:    'tpPlayMrk',
		tpRptStartMrk:'tpRptStartMrk',
		tpRptEndMrk:  'tpRptEndMrk',
		tpPlayMrk:    'tpPlayMrk',
		tpTime:       'tpTime',			//PlayTime, Repeat start/end time
		tpPT0:        'tpPlayTime0', 
		tpPlay:       'tpPlay',
		tpStop:       'tpStop',
		tpStartTime:  'tpStartTime',
		tpRpt:        'tpRepeat',
		tpSetRptTime: 'tpSetRptTime',
		tpTrackWnd:   'tpTrackWnd',		//display mode: Track
		tpMixerWnd:   'tpMixerkWnd',		//display mode: Mixer
		tpEffectWnd:  'tpEffectWnd',		//display mode: Effect
		tpDispMode:   'tpDispMode',		//display mode
		//Common: Inspector, Track, Mixer, FX --------------------------------------
		pan:     'pan',
		gain:    'gain',
		centPan: 'centPan',
		mute:    'mute',
		solo:    'solo',
		amRec:   'amRec',
		amPlay:  'amPlay',
		effect:  'effect',
		icon:    'icon',
		name:    'name',
		//Track All disable Mute/Solo, autoscroll, zoom up/down time -----------------
		trAllDisableMute:'trAllDisableMute',
		trAllDisableSolo:'trAllDisableSolo',
		trAutoScroll:    'trAutoScrl',
		trEnlargeTime:   'trEnlargeTime',
		trReduceTime:    'trReduceTime',
		//Time Ruler ---------------------------------------------------------------
		timeRuler:        'timeRuler',
		tmRlrRptStartMrk: 'timeRulerRepeatStartMark',
		tmRlrRptEndMrk:   'timeRulerRepeatEndMark',
		//Track Ch -----------------------------------------------------------------
		trChIconName: 'trChIconName',
		trChAmBtn:    'trChAmBtn',			//disp/hide AM track
		trChAmEnlarge:'trChAmEnlarge',	//zoom up for AM track
		trChAmreduce: 'trChAmReduce',		//zoon down for AM track
		trChAmType:   'trChAmType',
		trChAmTime:   'trChAmTime',
		trChAmVal:    'trChAmVal',
		trChAmDel:    'trChAmDel',
		trChAmAdd:    'trChAmAdd',
		trChAmMove:   'trChAmMove',
		trChAmEdit:   'trChAmEdit',
		//Track View ---------------------------------------------------------------
		trVwWaveForm: 'trViewWaveForm',	//Wave form
		trVwAmDel:    'trViewAmDel',		//AM mode: del
		trVwAmAdd:    'trViewAmAdd',		//AM mode: add
		trVwAmMove:   'trViewAmMove',		//AM mode: move
		trVwAmEdit:   'trViewAmEdit',		//AM mode: edit
		trVwAmOff:    'trViewAmOff',		//AM mode: off
		//Mixer Icon Select --------------------------------------------------------
		mxIcnSelctAuto:  'mxIcnSelctAuto',		//Auto
		mxIcnSelctRythm: 'mxIcnSelctRythm',		//Rythm
		mxIcnSelctAllOn: 'mxIcnSelctAllOn',		//All On
		mxIcnSelctAllOff:'mxIcnSelctAllOff',	//All Off
		mxIcnSelctPartA: 'mxIcnSelctPartA',		//Part A
		mxIcnSelctPartB: 'mxIcnSelctPartB',		//Part B
		mxIcnSelctPartC: 'mxIcnSelctPartC',		//Part C
		mxIconChkBox:    'mxIcnChkBox',				//check boxes
		mxPosMix:        'mxPosMix',					//Position Mixer
		//Mixer Icon Select --------------------------------------------------------
		mxGenMixIcon:    'mxGenMixIcon',			//Icon of general mixer 
		//FX -----------------------------------------------------------------------
		fxSlctCh: 'fxSlctCh',			//select current / output ch.
		fxPrevMrk:'fxPrevMrk',		//triangle mark for previous ch.
		fxNextMrk:'fxNextMrk',		//triangle mark for next ch.
		fxPrevIcon:'fxPrevIcon',	//Previous icon
		fxNextIcon:'fxNextIcon',	//Next icon
		//EQ -----------------------------------------------------------------------
		eqSW:      'eqSW',				//EQ SW
		eqFiltNo:  'eqFiltNo',		//Filter No.
		eqFiltType:'eqFiltType',	//Filter Type
		eqParam:   'eqParam',			//Freq, Q, Gain
		eqMarker:  'eqMarker',		//Marker
		//Comp ---------------------------------------------------------------------
		compSW:     'compSW',			//Comp SW
		compParam:  'compParam',	//Threshold, Knee, Attack, Release
		compRatio:  'compRatio',	//Ratio
		compMarker: 'compMarker',	//Marker
	},

	msgOffsetH: 1,
	msgOffsetW: 10,


	/*message: opening --------------------------------------------------------*/
	isMacSafari: false,
	msgOpen:'<p style="text-align:center;color:orange;font-size:14px">Notice</p>'
	+'<p>This application enables a function of navigation which displays the message at a mouse position how to use this application.</p>'
	+'<p>Please click \"<font color="blue">Navigation</font>\" below the menu or press key \"<font color="blue">n</font>\" if you need this function or not.</p>'
	+'<p>Also, the information about this application describe each page of the following menu respectively.</p>'
	+'<p>This message closes automatically when another message displays after moved your mouse.</p>',
	msgSafari:'<hr><p>This application may sound high-frequency noisy under your condition.</p>'
	+'In the case, please click \"<font color="red">About Safari</font>\" below the menu and disable effects following the contents in the page.',

	/*message: common ----------------------------------------------------------*/
	//PlayTime, Repeat Start/End Time, EQ/Comp Param 
	msgDnd:'<font color="blue">Drag & Drop for vertical</font> changes the value.',
	//Pan, Gain
	msgDndClick:'<font color="blue">Drag & Drop</font> or <font color="blue">click</font> to change the value.',
	msgCentPan:'Set panning to <font color="blue">center</font>.',
	//Mute, Solo, AM Rec/Play, Effect
	msgMute:'Enable/disable Mute.',
	msgSolo:'Enable/disable Solo.',
	msgAmRec:'Enable/disable to record for automation.',
	msgAmPlay:'Enable/disable to play for automation.',
	msgEffect:'Change <font color="blue">Effect</font> window.',

	//message: Transpose ---------------------------------------------------------
	msgTpPlayMrk:'Play time',
	msgTpRptStartMrk:'Repeat start time',
	msgTpRptEndMrk:'Repeat end time',
	msgPT0:'Set play time to <font color="blue">zero.</font> <hr>Shortcut key:<font color="blue">s</font>',
	msgPlay:'Play audio. <hr> Shortcut key:<font color="blue">space</font>',
	msgStop:'Stop audio. <hr> Shortcut key:<font color="blue">space</font>',
	msgStartTime:'Set <font color="blue">play time at start audio</font> after clicked stop button. <hr>Shortcut key:<font color="blue">h</font>',
	msgRpt:'Repeat enable/disable <hr>Shortcut key:<font color="blue">r</font>',
	msgSetRptTime:'Set <font color="blue">repeat start/end time</font> for the song part.',
	msgTpTrackWnd:'Change <font color="blue">Track</font> window.<hr>Shortcut key:<font color="blue">0</font>',
	msgTpMixerWnd:'Change <font color="blue">Mixer</font> window.<hr>Shortcut key:<font color="blue">1</font>',
	msgTpEffectWnd:'Change <font color="blue">Effect</font> window.<hr>Shortcut key:<font color="blue">2</font>',

	//message: Track - All clr Mute/Solo, auto scroll, zoom up/down(time) --------
	msgAllDisableMute:'<font color="blue">Disable mute for all audio channels</font> in the case of this button colored yellow.',
	msgAllDisableSolo:'<font color="blue">Disable solo for all audio channels</font> in the case of this button colored green.',
	msgAutoScroll:'Scroll <font color="blue">time ruler</font> and <font color="blue">track lane</font> automatically.',
	msgEnlargeTime:'Enlarge time direction.',
	msgReduceTime:'Reduce time direction.',

	//message:Time Ruler ---------------------------------------------------------
	msgTimeRuler:'Change the \"play line\" and \"play time\" with <font color="blue">click</font>.',
	msgTmRlrRptStartMrk:'Change the mark position for \"repeat start time\"<br>with a <font color="blue">click</font> and key <font color="blue">command(Mac)</font>/<font color="blue">ctrl(PC)</font>.',
	msgTmRlrRptEndMrk:'Change the mark position for \"repeat end time\"<br>with <font color="blue">click</font> and key <font color="blue">option(Mac)</font>/<font color="blue">alt(PC)</font>.',
	
	//message:Track Ch -----------------------------------------------------------
	msgTrChIconName:'<font color="blue">Change an audio channel</font> in \"Inspector\" after clicked.',
	msgTrChAmBtn:'Display/hide an automation track.',
	msgTrChAmType:'Select a type of automation.',
	msgTrChAmEnlarge:'Enlarge vertical direction.',
	msgTrChAmReduce:'Reduce vertical direction.',
	msgTrChAmDel:'Enable to delete an automation datum in \"Track lane.\"',
	msgTrChAmAdd:'Enable to add an automation datum in \"Track lane.\"',
	msgTrChAmMove:'Enable to move an automation datum in \"Track lane.\"',
	msgTrChAmEdit:'Enable to edit an automation datum in \"Track lane.\"',
	
	//message:Track View ---------------------------------------------------------
	msgTrVwWaveForm:'<font color="blue">Clicking</font> this track lane sets \"play line\" position.'+'<br>'+
	'Also, <font color="blue">clicking</font> with key <font color="blue">command(Mac)/ctrl(PC)</font> sets<br> repeat start/end times for a wave form.',
	msgTrVwAmDel:'Click to delete a <font color="red">red marker</font> selected by mouse.',
	msgTrVwAmAdd:'Set a <font color="blue">marker</font> after clicked in this area.',
	msgTrVwAmMove:'Move a <font color="#00A000">green marker</font> with drag & drop after selected by mouse.',
	msgTrVwAmEdit:'Select a marker by mouse then the marker colors <font color="orange">orange</font>.<br>Click the <font color="orange">marker</font> then it is assgined to edit in the left area "Track menu."<br>Change automation value or time in "Track menu" for the assigned marker.<br>Click here to cancel the assigned marker.',
	msgTrVwAmOff:'Automation data(markers) display in this track lane. <br> Select a mode to edit data from \"Track menu(left area).\"'+'<hr>'+
	'Change each mode with a click & key(s) as following:<br>'+
	'<font color="red">Del</font>:click & option(Mac)/alt(PC),<br>'+
	'<font color="blue">Add</font>:click & command(Mac)/ctrl(PC),<br>' +
	'<font color="#00A000">Move</font>:click & shift,<br>' +
	'<font color="orange">Edit</font>:click & option/alt & command/ctrl,<br>' +
	'Off:click & option/alt & command/ctrl & shift.',

	//message:Mixer Icon Select --------------------------------------------------
	msgMxIcnSelctAuto:'Display icons at play time automatically.',
	msgMxIcnSelctRythm:'Display icons for \"<font color="blue">Rhythm</font>.\"',
	msgMxIcnSelctAllOn:'Display all icons.',
	msgMxIcnSelctAllOff:'Hide all icons.',
	msgMxIcnSelctPartA:'Display icons for the song part \"<font color="blue">A</font>.\"',
	msgMxIcnSelctPartB:'Display icons for the song part \"<font color="blue">B</font>.\"',
	msgMxIcnSelctPartC:'Display icons for the song part \"<font color="blue">C</font>.\"',
	msgMxIconChkBox:'Display/hide an icon in the right area \"Icon position\" <br> alternately after clicked.',
	msgMxPosMix:'Move an icon with drag & drop.<br>The directions as follow:<br><font color="blue">top</font>: volume to <font color="red">min</font>, <font color="blue">bottom</font>: volume to <font color="red">max</font>,<br>left: pan to left, right: pan to right.',
	
	//message:Mixer Icon Select --------------------------------------------------
	msgMxGenMixIcon:'Display an icon in \"Icon position\" after clicked.',

	//message:FX -----------------------------------------------------------------
	msgFxSlctCh:'Select part/output ch. to operate EQ and Compressor.',
	msgFxPrevMrk:'Set a previous ch. as  current ch. after clicked.',
	msgFxNextMrk:'Set a next ch. as  current ch. after clicked.',

	//message:EQ -----------------------------------------------------------------
	msgEqSW:'Enable/disable EQ.',
	msgEqFiltNo:'Display/hide a filter curve/marker in "EQ spectrum" alternately after clicked.<br>Also, the filter parameters set the corresponding input-boxes after checked the box.',
	msgEqFiltType:'Select a filter type as follow:<br>No.<font color="red">1</font>:LowShelf, Peaking,<br>No.<font color="#00A000">2</font> & <font color="#0000FF">3</font>:Peaking,<br>No.<font color="#FFA500">4</font>:HighShelf, Peaking.',
	msgEqMarker:'Clicking a marker sets the corresponding filter parameters.<br>Also, drag & drop changes <font color="blue">frequency</font> and <font color="blue">gain</font>.',

	//message:Comp ---------------------------------------------------------------
	msgCompSW:'Enable/disable compressor.',
	msgCompRatio:'Select ratio.',
	msgCompMarker:'Drag & drop changes <font color="blue">Threshold</font>.',


	/*============================================================================
	init
	============================================================================*/
	init: function(){
		/* Menu ------------------------------------------------------------------*/

		/* Quick Navi ------------------------------------------------------------*/
		this.e_divMsg = document.getElementById('msg');
		this.e_spnQnaviMsg = document.getElementById('spnQnaviMsg');
		this.evtMenuNavi();

		this.setMenuColorOfQuickNavi();
	},
	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Menu
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	EVENT: Navigation Menu
	============================================================================*/
	evtMenuNavi: function(){
		var self = this;
		$(function(){
			$("#liNavi").on('click', function(){
				isNavi = !isNavi;
				self.setMenuColorOfQuickNavi();
			});
		});
	},
	/*============================================================================
	Set menu color of Quick Navi  
	============================================================================*/
	setMenuColorOfQuickNavi: function(){
		if(isNavi){
			$("#liNavi").css({'color':'blue', 'backgroundColor':'orange'});
			this.e_spnQnaviMsg.style.display = 'block';
		}else{
			$("#liNavi").css({'color':'black', 'backgroundColor':'white'});
			this.e_spnQnaviMsg.style.display = 'none';
			this.hideMsg();
		}
	},
	/*============================================================================
	Set Border for Safari  
	============================================================================*/
	setBorderForMacSafari: function(){
		$('#liSafari').css('border', '1px solid orange');
	},


	/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
	Navigation
	++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
	/*============================================================================
	Get Navigation Type
	============================================================================*/
	getNavType: function(){
		return this.navType;
	},
	/*============================================================================
	Display quick navi message
	============================================================================*/
	dispOpening: function(){
		this.e_divMsg.style.top = '216px';
		this.e_divMsg.style.left = '192px';
		this.e_divMsg.style.width = '384px';
		this.e_divMsg.style.height = 'auto';
		if(this.isMacSafari) var msg = this.msgOpen + this.msgSafari;
		else var msg = this.msgOpen;
		this.e_divMsg.innerHTML = msg;
		this.e_divMsg.style.display = 'block';
	},
	/*============================================================================
	Display quick navi message
	============================================================================*/
	dispMsg: function(type, x, y){
		this.e_divMsg.style.top = String(y+this.msgOffsetH) + 'px';
		this.e_divMsg.style.left = String(x+this.msgOffsetW) + 'px';
		var navMsg = this.getNavMsgFromType(type);
		this.e_divMsg.style.width = 'auto';
		this.e_divMsg.style.height = 'auto';
		this.e_divMsg.innerHTML = navMsg;
		this.e_divMsg.style.display = 'block';
	},
	/*----------------------------------------------------------------------------
	Get Navigation Message From Type
	----------------------------------------------------------------------------*/
	getNavMsgFromType: function(type){
		switch(type){
			/*Transpose ------------------------------------------------------------*/
			case this.navType.tpPlayMrk:
				return this.msgTpPlayMrk;				//Play time
				break;
			case this.navType.tpRptStartMrk:
				return this.msgTpRptStartMrk;		//Repeat start time
				break;
			case this.navType.tpRptEndMrk:
				return this.msgTpRptEndMrk;			//Repeat end time
				break;
			case this.navType.tpTime:
				return this.msgDnd;
				break;
			case this.navType.tpPT0:
				return this.msgPT0;
				break;
			case this.navType.tpPlay:
				return this.msgPlay;
				break;
			case this.navType.tpStop:
				return this.msgStop;
				break;
			case this.navType.tpStartTime:
				return this.msgStartTime;
				break;
			case this.navType.tpRpt:
				return this.msgRpt;
				break;
			case this.navType.tpSetRptTime:
				return this.msgSetRptTime;
				break;
			case this.navType.tpTrackWnd:
				return this.msgTpTrackWnd;			//display mode: Track
				break;
			case this.navType.tpMixerWnd:
				return this.msgTpMixerWnd;			//display mode: Mixer
				break;
			case this.navType.tpEffectWnd:
				return this.msgTpEffectWnd;		//display mode: Effect
				break;
		//Common: Inspector, Track, Mixer, FX --------------------------------------
			case this.navType.pan:
			case this.navType.gain:
				return this.msgDndClick;
				break;
			case this.navType.centPan:
				return this.msgCentPan;
				break;
			case this.navType.mute:
				return this.msgMute;
				break;
			case this.navType.solo:
				return this.msgSolo;
				break;
			case this.navType.amRec:
				return this.msgAmRec;
				break;
			case this.navType.amPlay:
				return this.msgAmPlay;
				break;
			case this.navType.effect:
				return this.msgEffect;
				break;
			//Track All clear Mute/Solo, autoscroll, zoom up/down time -----------------
			case this.navType.trAllDisableMute:
				return this.msgAllDisableMute;
				break;
			case this.navType.trAllDisableSolo:
				return this.msgAllDisableSolo;
				break;
			case this.navType.trAutoScroll:
				return this.msgAutoScroll;
				break;
			case this.navType.trEnlargeTime:
				return this.msgEnlargeTime;
				break;
			case this.navType.trReduceTime:
				return this.msgReduceTime;
				break;
			//Time Ruler -------------------------------------------------------------
			case this.navType.timeRuler:
				return this.msgTimeRuler;					//Time Ruler
				break;
			case this.navType.tmRlrRptStartMrk:
				return this.msgTmRlrRptStartMrk;	//Repeat Start Mark
				break;
			case this.navType.tmRlrRptEndMrk:
				return this.msgTmRlrRptEndMrk;		//Repeat End Mark
				break;
			//Track Ch ---------------------------------------------------------------
			case this.navType.trChIconName:
				return this.msgTrChIconName;	//Icon or Ch. name
				break;
			case this.navType.trChAmBtn:
				return this.msgTrChAmBtn;			//AM Track display/hide
				break;
			case this.navType.trChAmType:
				return this.msgTrChAmType;		//AM TYPE
				break;
			case this.navType.trChAmEnlarge:
				return this.msgTrChAmEnlarge;	//AM zoom up
				break;
			case this.navType.trChAmReduce:
				return this.msgTrChAmReduce;	//AM zoom down
				break;
			case this.navType.trChAmTime:
				return this.msgDnd;						//AM time
				break;
			case this.navType.trChAmVal:
				return this.msgDnd;						//AM value
				break;
			case this.navType.trChAmDel:
				return this.msgTrChAmDel;			//AM delete mode
				break;
			case this.navType.trChAmAdd:
				return this.msgTrChAmAdd;			//AM add mode
				break;
			case this.navType.trChAmMove:
				return this.msgTrChAmMove;		//AM move mode
				break;
			case this.navType.trChAmEdit:
				return this.msgTrChAmEdit;		//AM edit mode
				break;
			//Track View -------------------------------------------------------------
			case this.navType.trVwWaveForm:
				return this.msgTrVwWaveForm;	//Wave form
				break;
			case this.navType.trVwAmDel:
				return this.msgTrVwAmDel;	//AM mode:del
				break;
			case this.navType.trVwAmAdd:
				return this.msgTrVwAmAdd;	//AM mode:add
				break;
			case this.navType.trVwAmMove:
				return this.msgTrVwAmMove;	//AM mode:move
				break;
			case this.navType.trVwAmEdit:
				return this.msgTrVwAmEdit;	//AM mode:edit 
				break;
			case this.navType.trVwAmOff:
				return this.msgTrVwAmOff;		//AM mode:off
				break;
			//Mixer Icon Select ------------------------------------------------------
			case this.navType.mxIcnSelctAuto:
				return this.msgMxIcnSelctAuto;		//Auto
				break;
			case this.navType.mxIcnSelctRythm:
				return this.msgMxIcnSelctRythm;	//Rythm
				break;
			case this.navType.mxIcnSelctAllOn:
				return this.msgMxIcnSelctAllOn;	//All On
				break;
			case this.navType.mxIcnSelctAllOff:
				return this.msgMxIcnSelctAllOff;	//All Off
				break;
			case this.navType.mxIcnSelctPartA:
				return this.msgMxIcnSelctPartA;	//Part A
				break;
			case this.navType.mxIcnSelctPartB:
				return this.msgMxIcnSelctPartB;	//Part B
				break;
			case this.navType.mxIcnSelctPartC:
				return this.msgMxIcnSelctPartC;	//Part C
				break;
			case this.navType.mxIconChkBox:
				return this.msgMxIconChkBox;		//check boxes
				break;
			case this.navType.mxPosMix:
				return this.msgMxPosMix;				//Position Mixer
				break;
			//Mixer Icon Select ------------------------------------------------------
			case this.navType.mxGenMixIcon:
				return this.msgMxGenMixIcon;	//Icon of general mixer 
				break;
			//FX ---------------------------------------------------------------------
			case this.navType.fxSlctCh:
				return this.msgFxSlctCh;		//select current / output ch.
				break;
			case this.navType.fxPrevMrk:
				return this.msgFxPrevMrk;		//triangle mark for previous ch.
				break;
			case this.navType.fxNextMrk:
				return this.msgFxNextMrk;		//triangle mark for next ch.
				break;
			case this.navType.fxPrevIcon:
				return this.msgFxPrevIcon;	//Previous icon
				break;
			case this.navType.fxNextIcon:
				return this.msgFxNextIcon;	//Next icon
				break;
			//EQ -----------------------------------------------------------------------
			case this.navType.eqSW:
				return this.msgEqSW;					//EQ SW
				break;
			case this.navType.eqFiltNo:
				return this.msgEqFiltNo;			//Filter No.
				break;
			case this.navType.eqFiltType:
				return this.msgEqFiltType;		//Filter Type
				break;
			case this.navType.eqParam:
				return this.msgDnd;						//Freq, Q, Gain
				break;
			case this.navType.eqMarker:
				return this.msgEqMarker;			//Marker
				break;
			//Comp ---------------------------------------------------------------------
			case this.navType.compSW:
				return this.msgCompSW;			//Comp SW
				break;
			case this.navType.compParam:
				return this.msgDnd;					//Threshold, Knee, Attack, Release
				break;
			case this.navType.compRatio:
				return this.msgCompRatio;		//Ratio
				break;
			case this.navType.compMarker:
				return this.msgCompMarker;	//Marker
				break;
		};
	},
	/*============================================================================
	Hide quick navi message
	============================================================================*/
	hideMsg: function(){
		this.e_divMsg.innerHTML = '';
		this.e_divMsg.style.display = 'none';
		this.e_divMsg.style.top = '888px';
		this.e_divMsg.style.left = '10px';
	},
	/*============================================================================
	Change Navigation Mode form Doc
	============================================================================*/
	chgNaviModeFromDoc: function(){
		// console.log('chgNaviModeFromDoc @ objNavi');
		isNavi = !isNavi;
		this.setMenuColorOfQuickNavi();
	},
	/*============================================================================
	use message for sarai in max os
	============================================================================*/
	useMsgForMacSafari: function(){
		this.isMacSafari = true;
	},
}; //EOF objNavi
