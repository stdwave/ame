interval = 71;
timerID = null;

self.addEventListener('message', function(e){
	var data = e.data;
	switch(data.mode){
		case 'rec':
			self.postMessage({'mode':data.mode, 'ch':data.ch, 'time':data.time, 'type':data.type, 'val':data.val});
			break;
		case 'play':
			console.log(data);
			timerID = setInterval(function(){self.postMessage({'mode':'play', 'ch':data.ch});}, interval);
			break;
		case 'stop':
			console.log(data);
			if(timerID !== null){
				clearInterval(timerID);
				timerID = null;
			}
			break;
	}
});