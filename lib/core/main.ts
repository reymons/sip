import * as http from "http";

const server = http.createServer();

server.listen(7000, () => {
    console.log("Server is running...");
});
