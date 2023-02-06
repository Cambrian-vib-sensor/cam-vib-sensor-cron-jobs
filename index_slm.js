const fsSync = require('fs');
const fs = fsSync.promises;
const mysql = require('mysql');
const util = require('util');
const modbus = require("modbus-stream");


//The environment variables are defined here as the process is run from Windows Task Scheduler
const DB_PORT = 3306;
const DB_NAME = "test";
const DB_HOST = "localhost";
const DB_USER = "test";
const DB_PWD = "kA2xgAezF1";
const CONNECTION_LIMIT = 10;
const ROOT_PATH = "C:\\CambrianBackendProcessing\\";												 

const PAGE_SIZE = 10;
const WAIT_TIME = 2000;

//dotenv.config();
const pool = mysql.createPool({ host: DB_HOST, 
                    connectionLimit: CONNECTION_LIMIT,
                    port: DB_PORT, 
                    database: DB_NAME, 
                    user: DB_USER,
                    password: DB_PWD});

const query = util.promisify(pool.query).bind(pool);

const formatDateTime = (d) => {
    return d.getFullYear() + "-" + (d.getMonth()+1).toString().padStart(2, '0') + "-" + d.getDate().toString().padStart(2,'0') + " " + d.getHours().toString().padStart(2,'0') + ":" + d.getMinutes().toString().padStart(2,'0') + ":" + d.getSeconds().toString().padStart(2,'0');
}

const tcpconnect = util.promisify(modbus.tcp.connect).bind(modbus.tcp);
var connection;


async function saveData() {
    try {  
        connection = await tcpconnect(502, "192.168.1.109", { debug: "automaton-2454" });

        const writeSingleRegister = util.promisify(connection.writeSingleRegister).bind(connection);
        const readInputRegisters = util.promisify(connection.readInputRegisters).bind(connection);

        let res = await writeSingleRegister({ address: 263, value: Buffer.from([0,5]), extra: { unitId: 1 }});
        console.log(res.response);

        res = await readInputRegisters({ address: 520, quantity: 1, extra: { unitId: 1 } });
        console.log(res.response);

        let data = res.response.data[0].readInt16BE();
        console.log(data/10);

        await query('INSERT INTO noisesensor (leq_5min) VALUES (?)', data/10);
        
    } catch (err) {
        console.log(err.message);
        throw err;		  
    }
}

saveData().then(() => console.log("Success")).catch(error=>console.log(error.message)).finally(()=>{connection.close();pool.end(); console.log("Completed")}); //Run once