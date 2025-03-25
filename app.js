const express = require("express");
const path = require('path');
const mysql = require("mysql");
const dotenv = require('dotenv');
const cookieParser = require("cookie-parser");
dotenv.config({path: './.env'});
const app = express();
const db = mysql.createPool({
    connectionLimit: 10,
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE,
    waitForConnections: true,
    acquireTimeout: 10000, 
    connectTimeout: 10000, 
    multipleStatements: true
});
app.use(cookieParser());
const publicDirectory = path.join(__dirname, './public');
app.use(express.static(publicDirectory));
app.set('view engine', 'hbs');
app.use(express.urlencoded({extended: true}));
app.use(express.json());
app.use((req, res, next) => {
    req.db = db;
    next();
});

db.getConnection( (error, connection) => {
    if(error){
        console.log(error)
    }
    else{
        console.log("MySQL connected Successfully");
        connection.release();
    }
})
db.on("error", (err) => {
    console.error("MySQL Pool Error:", err.code);
    if (err.code === "PROTOCOL_CONNECTION_LOST" || err.code === "ECONNRESET") {
        console.log("Reconnecting to MySQL...");
        reconnectDB();
    }
});

// Function to reconnect MySQL
function reconnectDB() {
    setTimeout(() => {
        db.getConnection((err, connection) => {
            if (err) {
                console.error("MySQL Reconnection Failed:", err);
            } else {
                console.log("Reconnected to MySQL");
                connection.release();
            }
        });
    }, 2000);
}

setInterval(() => {
    db.query("DELETE FROM medicines WHERE medicineExpiryDate < CURDATE()", (err, result) => {
        if (err) {
            console.error("Error deleting expired medicines:", err);
        } else if (result.affectedRows > 0) {
            console.log(`Deleted ${result.affectedRows} expired medicines.`);
        }
    });
}, 3600000);
app.use('/', require('./routes/pages'));
app.use('/auth', require('./routes/auth'));
app.listen(5002, () => {
    console.log("Server started on 5002")
})