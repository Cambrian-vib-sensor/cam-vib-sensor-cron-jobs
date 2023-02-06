const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const mysql = require('mysql');
//const base64url = require('base64url');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

const pool = mysql.createPool({ host: 'localhost', 
                    connectionLimit: process.env.CONNECTION_LIMIT,
                    port: process.env.DB_PORT, 
                    database: process.env.DB_NAME, 
                    user: process.env.DB_USER,
                    password: process.env.DB_PWD});

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

/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listLabels(auth) {
    const gmail = google.gmail({version: 'v1', auth});            

    const res = await gmail.users.labels.list({
        userId: 'me',
    });
    const labels = res.data.labels;
    if (!labels || labels.length === 0) {
        console.log('No labels found.');
        return;
    }
    console.log('Labels:');
    labels.forEach((label) => {
        console.log(`- ${label.name}`);
    });
}

async function getEmail(message) {
    console.log(message.id);
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
            await fs.appendFile(
                    "messages.txt", JSON.stringify(email, null, "\t"))
    
            console.log(JSON.stringify(email));
            console.log(email);
        } catch (err) {
            console.error(err);
            //Log Error - later
        }
    } //Else log error - later 
}

var nextToken="";
async function listEmails(auth) {
    const gmail = google.gmail({version: 'v1', auth}); 
    const fromdate = new Date('2022-10-12T14:00:00');
    const todate = new Date('2022-10-12T14:30:00');

    const fromInSeconds = Math.floor(fromdate.getTime() / 1000);
    const toInSeconds = Math.floor(todate.getTime() / 1000);

    const query = `from:rt.anh0.abc@gmail.com OR from:rt.cfp8h.abc@gmail.com OR from:rt.cvv8.abc@gmail.com OR from:rt.cfbe.abc@gmail.com after:${fromInSeconds} before:${toInSeconds}`; 
    //const query = `from:rt.cfbe.abc@gmail.com after:${fromInSeconds} before:${toInSeconds}`; 
    //const query = `{from:rt.anh0.abc@gmail.com from:rt.cfp8h.abc@gmail.com from:rt.cvv8.abc@gmail.com} after:${fromInSeconds} before:${toInSeconds}`; 
    //const query = "{from:rt.cvv8.abc@gmail.com from:rt.anh0.abc@gmail.com} after:" + fromInSeconds  + " before:" + toInSeconds;
    
    console.log(query);

    do {
        var options = {
            userId: 'me',
            maxResults: 25,
            q: query
        }
        if (nextToken != "") {
            options.pageToken = nextToken;
        }
        const res = await gmail.users.messages.list(options).catch((err) => {
            console.error(err);
        });        
        console.log(res.data);
        console.log(res.data.resultSizeEstimate);
        if (res.data && res.data.messages) { //res.data.resultSizeEstimate > 0
            var getEmailOptions = {gmail:gmail};
            await Promise.allSettled(res.data.messages.map(getEmail, getEmailOptions)).then(async (messages) => { //(message) => getEmail(message, gmail)
                //messages.forEach(saveEmail);
                await Promise.allSettled(messages.map(saveEmail));
            });
        }
        if (res.data && res.data.nextPageToken) {
            nextToken = res.data.nextPageToken;
        } else {
            nextToken = "";
        }
    } while (nextToken != "")
}

async function retrieveEmails(auth) {
    const gmail = google.gmail({version: 'v1', auth});
    const content = await fs.readFile("messageList.txt");
    const messages = JSON.parse(content);
    //const messages = res.data.messages;
    if (!messages || messages.length === 0) {
        console.log('No messages found.');
        return;
    }
    console.log('messages:');
    let allMessages = [];
    i=1;
    for (const message of messages) {
        console.log(i + " " + message.id);
        i++;
        const messageFull = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'full'
        });
        allMessages.push(messageFull)
        //console.log(messageFull);
        //console.log(`- ${messageFull.payload.body.name}`);
        //console.log(`- ${messageFull.payload.headers.value}`); //payload.body.data
    }

    console.log(allMessages);
    
    let exists = await fs.exists("messages.txt");
    if (exists) {
        await fs.unlink("messages.txt");
    }

    try {
        await fs.appendFile(
                "messages.txt", JSON.stringify(allMessages, null, "\t"))
  
        console.log("File written successfully");
    } catch (err) {
        console.error(err);
    }
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
            let datum = dat.value;
            //console.log(`- ${datum.data.snippet}`);
            
            subjectObj = datum.data.payload.headers.filter((el, i, arr) => {if (el.name == "Subject") return true;});
            fromObj = datum.data.payload.headers.filter((el, i, arr) => {if (el.name == "From") return true;});
            toObj = datum.data.payload.headers.filter((el, i, arr) => {if (el.name == "To") return true;});
            dateObj = datum.data.payload.headers.filter((el, i, arr) => {if (el.name == "Date") return true;});

            if (fromObj[0].value.includes("rt.anh0.abc") && subjectObj[0].value.includes("CHrW_VM1R_22 AMK Ind Park 2")){

            var seconds = datum.data.internalDate;
            var d = new Date(0); // The 0 there is the key, which sets the date to the epoch
            d.setUTCMilliseconds(seconds);
            var dateObj2 = d.getFullYear() + "/" + (d.getMonth()+1).toString().padStart(2, '0') + "/" + d.getDate().toString().padStart(2,'0') + " " + d.getHours().toString().padStart(2,'0') + ":" + d.getMinutes().toString().padStart(2,'0') + ":" + d.getSeconds().toString().padStart(2,'0');

            //console.log(subjectObj);
            //console.log(`Subject - ${subjectObj[0].value} From - ${fromObj[0].value} To - ${toObj[0].value}  Date - ${dateObj[0].value} \n`);
            console.log(`${++i} ${subjectObj[0].value} From - ${fromObj[0].value} Date - ${dateObj2} ${datum.data.snippet.replace("Velocity -&gt; ","")}\n`);
            /*if (datum.data.payload.body.size > 0 ) {
                console.log(base64url.decode(datum.data.payload.body.data))
            }*/
        //}
            }
    });
}





//authorize().then(listEmails).catch(error=>console.log(error));
//authorize().then(retrieveEmails).catch(error=>console.log(error));
displayEmail().then();
console.log("Done");