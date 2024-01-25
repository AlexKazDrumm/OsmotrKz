import express from 'express';
import db from './queries.js';
import cors from 'cors';
import bodyParser from 'body-parser';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const app = express();

app.use(cors());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, './uploads/');
    },
    filename: function(req, file, cb) {
        let randomPostfix = (Math.floor(Math.random() * 1000000) + 1).toString();
        cb(null, randomPostfix + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

app.get('/', (request, response) => {
    response.json({ info: 'Node.js, Express, and Postgres API' })
})

app.post('/register', upload.fields([
    { name: 'sertificate', maxCount: 1 },
    { name: 'insurance_contract', maxCount: 1 },
    { name: 'ward', maxCount: 1 }
]), db.register);

app.post('/registerSimple', db.registerSimple);

app.post('/auth', db.auth);
app.post('/updatePassword', db.updatePassword);
app.post('/editPersonData', db.editPersonData);
app.post('/authenticateWithECP', db.authenticateWithECP);
app.get('/getAllUsers', db.getAllUsers);
app.patch('/setAdminStatus', db.setAdminStatus);
app.post('/uploadAvatar', db.uploadAvatar);
app.post('/setUserAvatar', upload.single('avatar'), db.setUserAvatar);
app.post('/addRequest', upload.array('tehpassports', 10), db.addRequest);
app.get('/getAllRequests', db.getAllRequests);
app.post('/addToFavorites', db.addToFavorites);
app.get('/getFavorites/:person_id', db.getFavorites);
app.delete('/removeFromFavorites/:person_id/:request_id', db.removeFromFavorites);
app.get('/getAllCities', db.getAllCities);
app.post('/addNewResponse', db.addNewResponse);
app.get('/getUserResponses/:user_id', db.getUserResponses);
app.get('/getResponsesForOrder/:order_id', db.getResponsesForOrder);
app.post('/uploadWorkPhoto', upload.single('workPhotoFile'), db.uploadWorkPhoto);
app.post('/respondToResponse', db.respondToResponse);
app.get('/getOrderDetails/:order_id', db.getOrderDetails);
app.get('/getAllImageGroups', db.getAllImageGroups);
app.post('/confirmWorkCompletion', db.confirmWorkCompletion);
app.post('/rejectWorkCompletion', db.rejectWorkCompletion);
app.post('/rejectResponse', db.rejectResponse);
app.post('/addBalance', db.addBalance);
app.post('/reduceBalance', db.reduceBalance);
app.post('/uploadWorkPhotos', upload.array('workPhotoFiles'), db.uploadWorkPhotos);
app.delete('/deleteWorkPhoto/:id', db.deleteWorkPhoto);
app.get('/getPhotosByCategories/:request_id', db.getPhotosByCategories);
app.put('/updateMovableProperty', db.updateMovableProperty);
app.post('/createReport', upload.fields([{ name: 'sign', maxCount: 1 }, { name: 'lpoPhotos', maxCount: 10 }]), db.createReport);
app.delete('/deleteLpoPhoto/:id', db.deleteLpoPhoto);
app.get('/getReportData/:id', db.getReportData);
app.put('/updateRequestStatus', db.updateRequestStatus);

app.get('/file/:filename', (request, response) => {
    const filename = request.params.filename;
    const filePath = path.join(__dirname, 'uploads', filename);

    // Проверка на существование файла
    if (fs.existsSync(filePath)) {
        // Отправка файла для просмотра в браузере
        response.sendFile(filePath);
    } else {
        // Если файл не найден, отправить сообщение об ошибке
        response.status(404).send('File not found');
    }
});

let port = process.env.PORT || 3033;

app.listen(port, (err) => {
    if (err){
        throw Error(err);
    }
    console.log(`Backend running on port ${port}.`)
})