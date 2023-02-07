const fs = require('fs').promises;
//const path = require('path');
//const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const mysql = require('mysql');
//const dotenv = require('dotenv');
const util = require('util');
// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.

//The environment variables are defined here as the process is run from Windows Task Scheduler
const DB_PORT = 3306;
const DB_NAME = "cambrian_vibration_monitoring";
const DB_HOST = "localhost";
const DB_USER = "cambrian_backend";
const DB_PWD = "PXOsWIaLUFkiDJG";
const CONNECTION_LIMIT = 10;
const ROOT_PATH = "C:\\CambrianBackendProcessing\\";
const TOKEN_PATH = ROOT_PATH + 'token.json'; //path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = ROOT_PATH + 'credentials.json'; //path.join(process.cwd(), 'credentials.json');
const LAST_RUN_PATH = ROOT_PATH + 'last_run_5min_interval.txt';

const PAGE_SIZE = 10;

//dotenv.config();
const pool = mysql.createPool({ host: DB_HOST, 
                    connectionLimit: CONNECTION_LIMIT,
                    port: DB_PORT, 
                    database: DB_NAME, 
                    user: DB_USER,
                    password: DB_PWD});

const query = util.promisify(pool.query).bind(pool);

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
    try {
        const content = await fs.readFile(TOKEN_PATH);
        const credentials = JSON.parse(content);
        return google.auth.fromJSON(credentials);
    } catch (err) {
        return null;
    }
}

/**
 * Serializes credentials to a file comptible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
        return client;
    }
    client = await authenticate({
        scopes: SCOPES,
        keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
        await saveCredentials(client);
    }
    return client;
}

const formatDateTime = (d) => {
    return d.getFullYear() + "-" + (d.getMonth()+1).toString().padStart(2, '0') + "-" + d.getDate().toString().padStart(2,'0') + " " + d.getHours().toString().padStart(2,'0') + ":" + d.getMinutes().toString().padStart(2,'0') + ":" + d.getSeconds().toString().padStart(2,'0');
}

async function getEmail(message) {
    console.log(message.id);
    const result = await query('SELECT count(*) as cnt from sensordata where gmail_id = ?', [message.id]).catch(err=>{throw err});
    if (result[0].cnt) {
        return new Error(message.id + " already exists"); //Fulfill with an error object
    }
    const email = await this.gmail.users.messages.get({ //this is getEmailOptions Object from the caller
        userId: 'me',
        id: message.id,
        format: 'full'
    }).catch((err) => {
        throw err;
    });
    return email;
}

async function saveEmail(email) {
    if (!(email instanceof Error)) { 
        try {
			if (email.data.snippet.includes("Velocity -&gt;")) { //Gmail filtering for the search term Velocity does not work. Hence filtered here.
				const headers = email.data.payload.headers;
				const gmailid = email.data.id;
				const subject = headers.find(({name}) => name === "Subject");
				//using async to find Subject; it is good for filtering but for finding, find is better than async way as it stops at the first item found
				//const subject = await Promise.all(headers.map(async (el)=>el.name == "Subject")).then(results => headers.find((el, index)=>results[index]));
				const sensorid = subject.value.slice(0, subject.value.indexOf("-")).trim();

				const milliseconds = email.data.internalDate; //Date in milliseconds from epoch
				let d = new Date(0); //Passing 0 epoch => 1970-01-01T00:00:00.000Z
				d.setUTCMilliseconds(milliseconds);
				const receiveddate = formatDateTime(d);

				let sensorvalue = email.data.snippet.match(/\d+( ?E ?[-+]?[0-9])?/g); //Extract only the decimal value
				sensorvalue = sensorvalue ? parseFloat(sensorvalue.toString().replace(" ","")) : 0;
				//Following - yet another way to extract sesorvalue
				//value = parseFloat(email.data.snippet.replace("Velocity -&gt; ","").replace(" ",""));

				const result = await query('SELECT count(*) as cnt from sensordata where sensor_id = ? and received_at = ?', [sensorid, receiveddate]);
				if (!result[0].cnt) {
					const emailObj = [sensorid, sensorvalue, receiveddate, gmailid];
					this.push(emailObj);
					//Batch insert is better than individual insert
					//let result = await query('INSERT INTO sensordata (sensor_id, sensor_value, received_at, gmail_id) VALUES (?,?,?,?)', [sensorid, sensorvalue, receiveddate, gmailid]);
				} else {
					console.log([sensorid, receiveddate]);
				}
			}
        } catch (err) {
            throw err;
        }
    }
    else {
        console.log(email.message);
    }
}

var nextToken="";
async function listEmails(auth) {
    const gmail = google.gmail({version: 'v1', auth}); 

    const fromInSeconds = Math.floor(startDt.getTime() / 1000);
    const toInSeconds = Math.floor(endDt.getTime() / 1000);

    const gmailquery = `'Velocity' after:${fromInSeconds} before:${toInSeconds}`; 
    //const gmailquery = `from:rt.anh0.abc@gmail.com OR from:rt.cfp8h.abc@gmail.com OR from:rt.cvv8.abc@gmail.com OR from:rt.cfbe.abc@gmail.com OR from:rt.cljwb.abc@gmail.com OR from:rt.chjuh.abc@gmail.com after:${fromInSeconds} before:${toInSeconds}`; 
    //Emails should be put inside a table if they are used for searching. {} can also be used instead of OR
    //const gmailquery = `{from:rt.anh0.abc@gmail.com from:rt.cfp8h.abc@gmail.com from:rt.cvv8.abc@gmail.com} after:${fromInSeconds} before:${toInSeconds}`; 
    
    console.log(gmailquery);

    do {
		try {
			let options = {
				userId: 'me',
				maxResults: PAGE_SIZE,
				q: gmailquery
			}
			if (nextToken != "") {
				options.pageToken = nextToken;
			}
			const res = await gmail.users.messages.list(options).catch((err) => {
				console.log("GMAIL List Emails: " + err.message);
				throw err;
			});

			if (res.data && res.data.messages) { //res.data.resultSizeEstimate > 0; resultSizeEstimate gives the size per page
				var getEmailOptions = {gmail:gmail};
				await Promise.all(res.data.messages.map(getEmail, getEmailOptions)).then(async (messages) => { 
					var emails = [];
					await Promise.all(messages.map(saveEmail, emails));
					if (emails.length) {
						await query('INSERT INTO sensordata (sensor_id, sensor_value, received_at, gmail_id) VALUES ?', [emails]);
					}
				});
			}
			if (res.data && res.data.nextPageToken) {
				nextToken = res.data.nextPageToken;
			} else {
				nextToken = "";
			}
		} catch(err) {
            console.log("List Emails: " + err.message);
            throw err;
            //ROLE BACK NOT REQUIRED
        }
    } while (nextToken != "")
}

var startDt, endDt;

/* Check for missing emails every 5 minutes starting from a given date */
const checkMissing = async () => {
    let lastRunDate = "";
    try {
        lastRunDate = await fs.readFile(LAST_RUN_PATH);
        lastRunDate = lastRunDate.toString();
    } catch (err) {
        lastRunDate = "2022-10-01T00:00:00";
    }

    if (!lastRunDate.length) { lastRunDate = "2022-10-01T00:00:00"; }

    let checkFromDate = new Date(lastRunDate);
    let checkUntilDate = new Date();
    var st = checkFromDate; 
    var ed = new Date(st);
    while (st < checkUntilDate) {
        ed.setMinutes(ed.getMinutes() + 5);
        const result = await query('SELECT count(*) as cnt from sensordata where received_at between ? and ?', [formatDateTime(st), formatDateTime(ed)]).catch(err=>{throw err});
        if (!result[0].cnt) {
            console.log("No data between " + formatDateTime(st) + " and " + formatDateTime(ed));
            startDt = new Date(st);
            startDt.setSeconds(startDt.getSeconds() - 1);  //To include the start time in gmail search condition
            endDt = new Date(ed);
            endDt.setSeconds(endDt.getSeconds() + 1);  //To include the end time in gmail search condition
            await authorize().then(listEmails).catch(error => {throw error});
        } else {
            console.log("OK: " + formatDateTime(st) + " and " + formatDateTime(ed));
        }
        st = new Date(ed);
    }

    checkUntilDate.setSeconds(0); //set seconds to 0 before saving to file
    await fs.writeFile(LAST_RUN_PATH, formatDateTime(checkUntilDate)).catch(err=>{throw err});
};

checkMissing().then(()=>console.log("Success")).catch((err) => {console.log(err);}).finally(()=>{pool.end();console.log("Completed")});