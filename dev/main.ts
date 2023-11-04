import SipServer from "../lib/core/main";
import http from "http";
import path from "path";
import fs from "fs";

const server = http.createServer();
const sipServer = new SipServer({
    output: path.join(__dirname, "result"),
    context: path.join(__dirname, "images"),
    formats: ["image/avif", "image/webp"]
});

server.on("request", (req, res) => {
    fs.readFile(__dirname + "/index.html", (err, data) => {
        if (err) {
            res.statusCode = 404;
            res.end();
        } else {
            res.writeHead(200, {
                "Content-Type": "text/html"
            });
            res.end(data);
        }
    });
});

sipServer.run(7000, () => console.log("Sip server is running"));
server.listen(4000, () => console.log("Server is running"));