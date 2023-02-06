const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const mysql = require('mysql');
const dotenv = require('dotenv');
const util = require('util');
const nodemailer = require('nodemailer');

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

const PAGE_SIZE = 10;
const WAIT_TIME = 300000; //5 mins

dotenv.config();
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

async function getEmail(message) {
    console.log(message.id);
    const email = await this.gmail.users.messages.get({ //this is getEmailOptions Object from the caller
        userId: 'me',
        id: message.id,
        format: 'full'
    }).catch((err) => {
        return err;
    });
    return email;
}

async function saveEmail(email) {
    if (!(email instanceof Error)) { 
        try {
            if (email.value.data.snippet.includes("Velocity -&gt;")) { //Gmail filtering for the search term Velocity does not work. Hence filtered here.
                const headers = email.value.data.payload.headers;
                const subject = headers.find(({name}) => name === "Subject");
                //using async to find Subject; it is good for filtering but for finding, find is better than async way as it stops at the first item found
                //const subject = await Promise.all(headers.map(async (el)=>el.name == "Subject")).then(results => headers.find((el, index)=>results[index]));
                const sensorid = subject.value.slice(0, subject.value.indexOf("-")).trim();

                const milliseconds = email.value.data.internalDate; //Date in milliseconds from epoch
                let d = new Date(0); //Passing 0 epoch => 1970-01-01T00:00:00.000Z
                d.setUTCMilliseconds(milliseconds);
                const receiveddate = d.getFullYear() + "-" + (d.getMonth()+1).toString().padStart(2, '0') + "-" + d.getDate().toString().padStart(2,'0') + " " + d.getHours().toString().padStart(2,'0') + ":" + d.getMinutes().toString().padStart(2,'0') + ":" + d.getSeconds().toString().padStart(2,'0');

                let sensorvalue = email.value.data.snippet.match(/\d+( ?E ?[-+]?[0-9])?/g);
                sensorvalue = sensorvalue ? parseFloat(sensorvalue.toString().replace(" ","")) : 0;
                //Following - yet another way to extract sesorvalue
                //value = parseFloat(email.value.data.snippet.replace("Velocity -&gt; ","").replace(" ",""));

                const result = await query('SELECT count(*) as cnt from sensordata where sensor_id = ? and received_at = ?', [sensorid, receiveddate]);
                if (!result[0].cnt) {
                    const emailObj = [sensorid, sensorvalue, receiveddate];
                    this.push(emailObj);
                    //Batch insert is better than individual insert
                    //let result = await query('INSERT INTO sensordata (sensor_id, sensor_value, received_at) VALUES (?,?,?)', [sensorid, sensorvalue, receiveddate]);
                }
            }
        } catch (err) {
            return(err);
            //Log Error to file - later
        }
    } //Else log error to file - later 
}

var nextToken="";
async function listEmails(auth) {
    const gmail = google.gmail({version: 'v1', auth});
    let startDt = new Date();
    console.log(startDt.toString());

    const result = await query('SELECT max(received_at) as startDt from sensordata');    
    if (result[0].startDt) { //Check later what it returns if table is empty
        startDt = new Date(result[0].startDt)
    }

    const fromdate = startDt;
    //const todate = new Date(endDt);

    const fromInSeconds = Math.floor(fromdate.getTime() / 1000);
    //const toInSeconds = Math.floor(todate.getTime() / 1000);

    const gmailquery = `'Velocity' after:${fromInSeconds}`; // before:${toInSeconds}
    //const gmailquery = `from:rt.anh0.abc@gmail.com OR from:rt.cfp8h.abc@gmail.com OR from:rt.cvv8.abc@gmail.com OR from:rt.cfbe.abc@gmail.com OR from:rt.cljwb.abc@gmail.com OR from:rt.chjuh.abc@gmail.com after:${fromInSeconds} before:${toInSeconds}`; 
    //Emails should be put inside a table if they are used for searching. {} can also be used instead of OR
    //const gmailquery = `{from:rt.anh0.abc@gmail.com from:rt.cfp8h.abc@gmail.com from:rt.cvv8.abc@gmail.com} after:${fromInSeconds} before:${toInSeconds}`; 
    
    console.log(gmailquery); 

    do {
        let options = {
            userId: 'me',
            maxResults: PAGE_SIZE,
            q: gmailquery
        }
        if (nextToken != "") {
            options.pageToken = nextToken;
        }
        const res = await gmail.users.messages.list(options).catch((err) => {
            console.error(err); //Add to logger file - later
        });     

        if (res.data && res.data.messages) { //res.data.resultSizeEstimate > 0; resultSizeEstimate gives the size per page
            var getEmailOptions = {gmail:gmail};
            await Promise.allSettled(res.data.messages.map(getEmail, getEmailOptions)).then(async (messages) => { 
                var emails = [];
                await Promise.allSettled(messages.map(saveEmail, emails));
                if (emails.length) {
                    await query('INSERT INTO sensordata (sensor_id, sensor_value, received_at) VALUES ?', [emails]);
                }
            });
        }
        if (res.data && res.data.nextPageToken) {
            nextToken = res.data.nextPageToken;
        } else {
            nextToken = "";
        }
    } while (nextToken != "")
}

findUnresponsiveSensors = async row => {           
    const lastReceived = await query('SELECT max(received_at) as startDt from sensordata where sensor_id = ?', row.sensor_id); 
    if (lastReceived.length) {
        const lastReceivedTime = new Date(lastReceived[0].startDt);
        const diffMilliSeconds = new Date() - lastReceivedTime;
        const minutes = diffMilliSeconds/60000; // milliseconds in 1 minute = 60000
        const style = `style="border: 1px solid black"`;
        if (minutes > 30) {
            //console.log(row.sensor_id);
            //console.log(Math.trunc(minutes));
            return `<tr><td ${style}>${row.sensor_id}</td><td ${style}>${lastReceivedTime.toLocaleString()}</td><td ${style}>${Math.trunc(minutes)}</td></tr>`;
        } else return "";
    }
}

async function sendEmail(emailbody){
    var transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: 'samsad@cambrian.com.sg',
          pass: 'hhqzizxexdwvwloi'
        }
      });
      
    var mailOptions = {
        from: 'samsad@cambrian.com.sg',
        to: 'chunyong@cambrian.com.sg, dianarose@cambrian.com.sg',
        //cc: 'samsad.beagum@gmail.com',
        subject: 'Unresponsive Sensors Alert',
        html: emailbody
    };

    transporter.sendMail = util.promisify(transporter.sendMail);
    info = await transporter.sendMail(mailOptions).catch(error => console.log(error));
    console.log(info.response);
}

async function alertCheck() {
    let minutesnow = new Date().getMinutes();
    //if (minutesnow == 0 || minutesnow == 30) {
        //const result = await query('SELECT distinct sensor_id from sensordata');
        //Select sensors linked to current locations only
        const result = await query('Select `sensor_id` from (SELECT distinct `sensor_id`, max(`received_at`) as `maxi` FROM `sensordata` group by `sensor_id` order by substring(`sensor_id`, 1, 4), `maxi` DESC) A group by substring(`sensor_id`, 1, 4)');
        if (result.length) {
            let emaildata = "";
            await Promise.all(result.map(findUnresponsiveSensors)).then(async (messages) => {
                let emaildata = messages.join('');
                if (emaildata.length) {
                    let emailbody = "The following sensors did not respond in the last 30 minutes: <br>";
                    emailbody += 
                            `
                            <table style="border-collapse:collapse"> 
                                <thead>
                                    <tr>
                                    <th style="border: 1px solid black">Sensor id</th>
                                    <th style="border: 1px solid black">Last Response Time LRT</th>
                                    <th style="border: 1px solid black">Minutes passed since LRT</th>
                                    </tr>
                                </thead>
                                <tbody>             
                            `;
                    emailbody += emaildata + "</tbody></table>";
                    await sendEmail(emailbody);
                }
            });
        }
    //}
}

//authorize().then(listEmails).then(alertCheck).catch(error=>console.log(error)).finally(()=>{pool.end(); console.log("Completed")}); //Run once
alertCheck().catch(error=>console.log(error)).finally(()=>{pool.end(); console.log("Completed")});

//The following runs infinitely
/*
const snooze = () => new Promise(resolve => setTimeout(resolve, WAIT_TIME));

const run = async () => {
    await authorize().then(listEmails).catch(error=>console.log(error)); //Retrieve
    await snooze(); //Sleep for 5 minutes
    await run(); //Run
};

run().then(()=>pool.end()) //Close the pool when the program ends
*/