var interval = 71;
var timerID = null;

self.addEventListener('message', function(e){
	var date = e.data;
	switch(date){
		case 'start':
			timerID = setInterval(function(){self.postMessage('start');}, interval);	//update played time
			break;
		case 'stop':
			if(timerID !== null){
				clearInterval(timerID);
				timerID = null;
				self.postMessage('stop');
			}
			break;
	};
}, false);
