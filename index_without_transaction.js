const fs = require('fs').promises;
//const path = require('path');
//const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const mysql = require('mysql');
//const dotenv = require('dotenv');
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
const CONNECTION_LIMIT = 2;
const ROOT_PATH = "C:\\CambrianBackendProcessing\\";
const TOKEN_PATH = ROOT_PATH + 'token.json'; //path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = ROOT_PATH + 'credentials.json'; //path.join(process.cwd(), 'credentials.json');

const PAGE_SIZE = 10;
const WAIT_TIME = 300000; //5 mins

//dotenv.config();
const pool = mysql.createPool({ host: DB_HOST, 
                    connectionLimit: CONNECTION_LIMIT,
                    port: DB_PORT, 
                    database: DB_NAME, 
                    user: DB_USER,
                    password: DB_PWD});

//Get a single connection. Pool is not required here because we require a single insert for all emails and it needs to be transacted once.
/*const getConnection = util.promisify(pool.getConnection).bind(pool);
var connection;
var query;
(async () => { 
    connection = await getConnection().catch(error => {console.log(error.message); return;}); 
    query = util.promisify(connection.query).bind(connection);
})();*/
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
    /* The following code may cause unnecessary delay for new emails. If the script is run for backdated emails, uncomment the following */
    /*const result = await query('SELECT count(*) as cnt from sensordata where gmail_id = ?', [message.id]);
    if (result[0].cnt) {
        return new Error(message.id + " already exists"); //Fulfill with an error object
    }*/
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
    if (!(email instanceof Error)) { //In case the message already exists, getEmail returns message already exists error, if the checking is included
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
                }
            }
        } catch (err) {
            throw err;
        }
    } // if checking of existing emails included, log error to file
}

var nextToken="";
async function listEmails(auth) {
    const gmail = google.gmail({version: 'v1', auth});
    let startDt = new Date();
    console.log(startDt.toString());

    const result = await query('SELECT max(received_at) as startDt from sensordata').catch(err => {throw err});    
    if (result[0].startDt) { //Check later what it returns if table is empty
        startDt = new Date(result[0].startDt)
    }

    startDt.setSeconds(startDt.getSeconds() - 1); //Just not to miss emails, retrieve from exactly the last time of finish of retrieval.

    const fromInSeconds = Math.floor(startDt.getTime() / 1000);

    const gmailquery = `'Velocity' after:${fromInSeconds}`; // before:${toInSeconds}
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
                    //console.log(messages[0].data.payload);
                    var emails = [];
                    await Promise.all(messages.map(saveEmail, emails)).catch(err => {console.log("Save Email: " + err.message); throw err});
                    if (emails.length) {
                        console.log("Inserting..");
                        await query('INSERT INTO sensordata (sensor_id, sensor_value, received_at, gmail_id) VALUES ?', [emails]);
                    } else {
                        console.log("List of emails to be saved is empty. Probably all emails already exist.");
                    }
                }).catch(err => {console.log("Get Email: " + err.message); throw err});
            }
            if (res.data && res.data.nextPageToken) {
                nextToken = res.data.nextPageToken;
            } else {
                nextToken = "";
            }
        } catch(err) {
            console.log("List Emails: " + err.message);
            throw err;
            //ROLE BACK ALL INSERT TRANSACTIONS - MUST
        }
    } while (nextToken != "")
}

findUnresponsiveSensors = async row => {           
    const lastReceived = await query('SELECT max(received_at) as startDt from sensordata where sensor_id = ?', row.sensor_id).catch(err => {throw err}); 
    if (lastReceived.length) {
        const lastReceivedTime = new Date(lastReceived[0].startDt);
        const diffMilliSeconds = new Date() - lastReceivedTime;
        const minutes = diffMilliSeconds/60000; // milliseconds in 1 minute = 60000
        const style = `style="border: 1px solid black"`;
        if (minutes > 30) {
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
    if (minutesnow == 0 || minutesnow == 30) {
        console.log("Checking alerts");
        //const result = await query('SELECT distinct sensor_id from sensordata');
        //Select sensors linked to current locations only
        const result = await query('Select `sensor_id` from (SELECT distinct `sensor_id`, max(`received_at`) as `maxi` FROM `sensordata` group by `sensor_id` order by substring(`sensor_id`, 1, 4), `maxi` DESC) A group by substring(`sensor_id`, 1, 4)').catch(err=>{throw err});
        if (result.length) {
            await Promise.all(result.map(findUnresponsiveSensors)).then(async (messages) => {
                let emaildata = messages.length ? messages.join('') : "";
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
                    await sendEmail(emailbody).catch(err => {throw err});
                }
            }).catch(err => {throw err});
        }
    }
}

authorize().then(listEmails).then(alertCheck).then(() => console.log("Success")).catch(error=>console.log(error.message)).finally(()=>{/*connection.release();*/pool.end(); console.log("Completed")}); //Run once

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