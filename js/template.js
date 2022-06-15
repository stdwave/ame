function topmenu(){
	var html = '<div id="menu">';
	html += '<ul id="ulMenu">';
	html += '<li class="liMenu"><a href="intro.html" target="_self">Introduction</a></li>';
	html += '<li class="liMenu"><a href="key-mouse.html" target="_self">Key/Mouse</li>';
	html += '<li class="liMenu"><a href="automation.html" target="_self">Automation</a></li>';
	html += '<li class="liMenu"><a href="about-safari.html" target="_self">About Safari</a></li>';
	html += '<li class="liMenu"><a href="demosong.html" target="_self">Demo song</a></li>';
	html += '</ul></div>';
	document.write(html);
};

function footer(){
	var html = '<footer id="footer">';
	html += '<p><small>&copy Y.Okubo All Rights Reserved.</small></p>';
	html += '</footer>';
	document.write(html);
};




