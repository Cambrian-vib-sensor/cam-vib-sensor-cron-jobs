const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const mysql = require('mysql');
const dotenv = require('dotenv');
const util = require('util');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

dotenv.config();
const pool = mysql.createPool({ host: 'localhost', 
                    connectionLimit: process.env.CONNECTION_LIMIT,
                    port: process.env.DB_PORT, 
                    database: process.env.DB_NAME, 
                    user: process.env.DB_USER,
                    password: process.env.DB_PWD});

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
    //console.log(message.id);
    const email = await this.gmail.users.messages.get({ //this is passed as getEmailOptions Object
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
            const headers = email.value.data.payload.headers;
            const subject = headers.find(({name}) => name === "Subject");
            //subject = await Promise.all(headers.map(async (el)=>el.name == "Subject")).then(results => headers.find((el, index)=>results[index])); //using async
            const sensorid = subject.value.slice(0, subject.value.indexOf("-")).trim();

            const milliseconds = email.value.data.internalDate; //Date in milliseconds from epoch
            let d = new Date(0); //Passing 0 epoch => 1970-01-01T00:00:00.000Z
            d.setUTCMilliseconds(milliseconds);
            const receiveddate = d.getFullYear() + "/" + (d.getMonth()+1).toString().padStart(2, '0') + "/" + d.getDate().toString().padStart(2,'0') + " " + d.getHours().toString().padStart(2,'0') + ":" + d.getMinutes().toString().padStart(2,'0') + ":" + d.getSeconds().toString().padStart(2,'0');

            let sensorvalue = email.value.data.snippet.match(/\d+( ?E ?[-+]?[0-9])?/g);
            sensorvalue = sensorvalue ? parseFloat(sensorvalue.toString().replace(" ","")) : 0;
            //value = parseFloat(email.value.data.snippet.replace("Velocity -&gt; ","").replace(" ",""));
            //console.log(sensorvalue)

            const result = await query('SELECT count(*) as cnt from sensordata1 where sensor_id = ? and received_at = ?', [sensorid, receiveddate]);
            if (!result[0].cnt) {
                const emailObj = [sensorid, sensorvalue, receiveddate];
                this.push(emailObj);
                //let result = await query('INSERT INTO sensordata (sensor_id, sensor_value, received_at) VALUES (?,?,?)', [sensorid, sensorvalue, receiveddate]);
            }
            /*await new Promise((resolve, reject) => {                
                query('INSERT INTO sensordata (sensor_id, sensor_value, received_at) VALUES (?,?,?)', [sensorid, sensorvalue, receiveddate], (error, result) => {
                    if (error) {
                        return reject(error);
                    } 
                    return resolve(result);
                });
            });*/
        } catch (err) {
            return(err);
            //Log Error - later
        }
    } //Else log error - later 
}

var nextToken="";
async function listEmails(auth) {
    const gmail = google.gmail({version: 'v1', auth}); 
    const fromdate = new Date('2022-04-30T23:59:59');
    const todate = new Date('2022-05-02T00:00:00');

    const fromInSeconds = Math.floor(fromdate.getTime() / 1000);
    const toInSeconds = Math.floor(todate.getTime() / 1000);

    const gmailquery = `'Velocity' after:${fromInSeconds} before:${toInSeconds}`; 
    //const gmailquery = `from:rt.anh0.abc@gmail.com OR from:rt.cfp8h.abc@gmail.com OR from:rt.cvv8.abc@gmail.com OR from:rt.cfbe.abc@gmail.com OR from:rt.cljwb.abc@gmail.com OR from:rt.chjuh.abc@gmail.com after:${fromInSeconds} before:${toInSeconds}`; 
    //Emails should be put inside a table if they are used for searching. {} can also be used instead of OR
    //const gmailquery = `{from:rt.anh0.abc@gmail.com from:rt.cfp8h.abc@gmail.com from:rt.cvv8.abc@gmail.com} after:${fromInSeconds} before:${toInSeconds}`; 
    
    console.log(gmailquery);

    do {
        let options = {
            userId: 'me',
            maxResults: 250,
            q: gmailquery
        }
        if (nextToken != "") {
            options.pageToken = nextToken;
        }
        const res = await gmail.users.messages.list(options).catch((err) => {
            console.error(err);
        });        

        if (res.data && res.data.messages) { //res.data.resultSizeEstimate > 0; resultSizeEstimate gives the size per page
            var getEmailOptions = {gmail:gmail};
            await Promise.allSettled(res.data.messages.map(getEmail, getEmailOptions)).then(async (messages) => { //(message) => getEmail(message, gmail)
                //messages.forEach(saveEmail);
                var emails = [];
                await Promise.allSettled(messages.map(saveEmail, emails));
                if (emails.length) {
                    await query('INSERT INTO sensordata1 (sensor_id, sensor_value, received_at) VALUES ?', [emails]);
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

async function displayEmail() {
    let content = await fs.readFile("messages.txt");
    content = '[' + content + ']';
    content =  content.replaceAll("}{", "},{");
    const data = JSON.parse(content);
    //console.log(data);
    let i = 0;
    data.forEach((dat) => {
        //if (datum.data.labelIds.includes("INBOX")) {
            const datum = dat.value;
            //console.log(`- ${datum.data.snippet}`);
            
            const subjectObj = datum.data.payload.headers.filter((el, i, arr) => {if (el.name == "Subject") return true;});
            const fromObj = datum.data.payload.headers.filter((el, i, arr) => {if (el.name == "From") return true;});
            const toObj = datum.data.payload.headers.filter((el, i, arr) => {if (el.name == "To") return true;});
            const dateObj = datum.data.payload.headers.filter((el, i, arr) => {if (el.name == "Date") return true;});

            //if (fromObj[0].value.includes("rt.anh0.abc") && subjectObj[0].value.includes("CHrW_VM1R_22 AMK Ind Park 2")){

            const seconds = datum.data.internalDate;
            let d = new Date(0); // The 0 there is the key, which sets the date to the epoch
            d.setUTCMilliseconds(seconds);
            let dateObj2 = d.getFullYear() + "/" + (d.getMonth()+1).toString().padStart(2, '0') + "/" + d.getDate().toString().padStart(2,'0') + " " + d.getHours().toString().padStart(2,'0') + ":" + d.getMinutes().toString().padStart(2,'0') + ":" + d.getSeconds().toString().padStart(2,'0');

            //console.log(subjectObj);
            //console.log(`Subject - ${subjectObj[0].value} From - ${fromObj[0].value} To - ${toObj[0].value}  Date - ${dateObj[0].value} \n`);
            console.log(`${++i} ${subjectObj[0].value} From - ${fromObj[0].value} Date - ${dateObj2} ${datum.data.snippet.replace("Velocity -&gt; ","")}\n`);
            /*if (datum.data.payload.body.size > 0 ) {
                console.log(base64url.decode(datum.data.payload.body.data))
            }*/
        //}
            //}
    });
}

async function testEmail() {
    let content = await fs.readFile("messages.txt");
    content = '[' + content + ']';
    content =  content.replaceAll("}{", "},{");
    const data = JSON.parse(content);
    var emails = [];
    await Promise.allSettled(data.map(saveEmail, emails));
    console.log(emails);
    if (emails.length) {
        await query('INSERT INTO sensordata1 (sensor_id, sensor_value, received_at) VALUES ?', [emails]);
    }
    pool.end();
}

authorize().then(listEmails).catch(error=>console.log(error)).finally(()=>pool.end());
//authorize().then(retrieveEmails).catch(error=>console.log(error));
//displayEmail().then();
//testEmail().then().catch(error=>console.log(error));
console.log("Done");