//const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const chokidar = require('chokidar');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const settings = require('./settings.json');
const http = require('node:https');


/*var settings = {
	watchPath : 'C:/imagestest/in',
	outputPath : 'C:/imagestest/out',
	width : 1920,
	height : 1080,
	azEndpoint : '',
	azKey : ''
	mailInterval : 5,
	mailFrom: "",
	mailTo: "",
	mailServer: {
		host: 'smtp.ethereal.email',
		port: 587,
		auth: {
			user: '[USERNAME]',
			pass: '[PASSWORD]'
		}
	}
}*/


const transporter = nodemailer.createTransport(settings.mailServer);

var emailQueue = [];

var watcher = chokidar.watch(settings.watchPath, {ignored: /^\./,ignoreInitial: true, persistent: true, awaitWriteFinish: true});

var processing = false;

watcher
  .on('add', function(path) {
	  console.log(`New JPEG file detected: ${path}`);
	  if (path.toLowerCase().endsWith('.jpg') && !processing) {
		processing = true;
		sendImage(path);
	  }
  })

setInterval(sendMailQueue, settings.mailInterval * 1000);		

function sendImage(filePath){

	const file = fs.readFileSync(filePath);

	const options = {
		method: 'POST',
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Length': file.length,
			'Ocp-Apim-Subscription-Key':settings.azKey
		}
	};
	
	var data = ""
	const req = http.request(settings.azEndpoint, options, (res) => {

		res.setEncoding('utf8');
		res.on('data', (chunk) => {
			console.log(`BODY: ${chunk}`);
			data+=chunk;
		});
		res.on('end', () => {
			//console.log('No more data in response.');
			data = JSON.parse(data);
			
			const { createCanvas, loadImage } = require('canvas');

			// Set the dimensions of the canvas
			const canvasWidth = settings.width;
			const canvasHeight = settings.height;

			// Create a new canvas instance
			const canvas = createCanvas(canvasWidth, canvasHeight);
			const ctx = canvas.getContext('2d');	


			loadImage(filePath)
				.then((image) => {
					// Draw the loaded image onto the canvas
					ctx.drawImage(image, 0, 0, canvasWidth, canvasHeight);

					// Save the canvas as an image
					var labels = [];
					for(var i = 0; i < data.objectsResult.values.length; i++){
						var prediction = data.objectsResult.values[i];
						const rectColor = '#ff0000';
						const text = `${prediction.tags[0].name} ${Math.round(prediction.tags[0].confidence * 100)}%`;
						labels.push(prediction.tags[0].name);
						const textColor = '#ff0000';
						const textSize = 20;
						const textX = prediction.boundingBox.x 
						const textY = prediction.boundingBox.y - 21;
						// Draw the text
						ctx.font = `${textSize}px Arial`;
						ctx.strokeStyle = rectColor;
						ctx.fillStyle = '#ffffff';
						const textWidth = ctx.measureText(text).width;							
						ctx.fillRect(textX, textY - 21, textWidth, 25);							
						ctx.fillStyle = '#ff0000';
						ctx.fillText(text, textX, textY);
						
						const rectX = prediction.boundingBox.x;
						const rectY = prediction.boundingBox.y;
						const rectWidth = prediction.boundingBox.w;
						const rectHeight = prediction.boundingBox.h;
						const rectLineWidth = 4;

						// Draw the unfilled rectangle
						ctx.strokeStyle = rectColor;
						ctx.lineWidth = rectLineWidth;
						ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);
						
					}
					
					var guid = uuidv4();
					const fs = require('fs');							
					const outputImagePath = `${settings.outputPath}/${guid}.jpg`; // Output file path
					const buffer = canvas.toBuffer('image/jpeg');
					fs.writeFileSync(outputImagePath, buffer);

					
					emailQueue.push({
						guid: guid,
						labels: labels
					})
					console.log(`Image saved to: ${outputImagePath}`);
					processing = false;
				})
				.catch((error) => {
					console.error(`Error loading the image: ${error}`);
					processing = false;
				});
								
			
		});
	});

	req.on('error', (e) => {
		console.error(`problem with request: ${e.message}`);
		processing = false;
	});

	// Write data to request body
	req.write(file);
	req.end(); 	
	
}

function uuidv4() {
   return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,
   function(c) {
      var uuid = Math.random() * 16 | 0, v = c == 'x' ? uuid : (uuid & 0x3 | 0x8);
      return uuid.toString(16);
   });
}

function sendMailQueue(){
	
	if(emailQueue.length > 0){
		var items = emailQueue.splice(0,emailQueue.length)
		var htmlStr = "";
		var labelsCombined = [];
		
		let message = {html:'',attachments:[]};
		
		for(var i = 0; i < items.length; i++){
			htmlStr += `<img src="cid:${items[i].guid}"/><br/>`;		
			for(var j = 0; j < items[i].labels.length; j++){
				if (!labelsCombined.includes(items[i].labels[j])){
					labelsCombined.push(items[i].labels[j]);
				}
			}
			message.attachments.push({
				filename: `${items[i].guid}.jpg`,
				path: `${settings.outputPath}/${items[i].guid}.jpg`,
				cid: items[i].guid //same cid value as in the html img src						
			});
		}
		
		var subject = "";
		
		for(var i = 0; i < labelsCombined.length; i++){
			if(subject != ""){
				subject += ", ";
			}
			subject += labelsCombined[i];
		}
			
		message.html = htmlStr;
		message.to = settings.mailTo;
		message.from = settings.mailFrom;
		message.subject = "Found: " + subject;	
		
		transporter.sendMail(message);	
		
		console.log(`Sending Message: ${message.subject}`);
	}	
}