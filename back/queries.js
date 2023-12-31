import pg from 'pg';
import moment from 'moment'
moment.locale('ru');
import { productionPoolOptions, secretKey } from './accesses.js';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { request } from 'http';
import { response } from 'express';


const Pool = pg.Pool
const pool = new Pool(productionPoolOptions);

const SALT_ROUNDS = 10;

const isEmailValid = (email) => /^\S+@\S+\.\S+$/.test(email);

const isEmailExists = async (email) => {
    const { rows } = await pool.query('SELECT email FROM smbt_users WHERE email = $1', [email]);
    return rows.length > 0;
};

const isPhoneNumberValid = phone => /^(\+?[7-8] ?\(\d{3}\) ?|\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{2}[- ]?\d{2}$/.test(phone);

const isCertificateNumberValid = number => /^\d{2} \d{2} \d{2} \d{2}$/.test(number);

const hashPassword = async (password) => {
    return bcrypt.hash(password, SALT_ROUNDS);
}

const generateToken = (userId) => {
    return jwt.sign({ id: userId }, secretKey, { expiresIn: '1h' });
};

const saveFileAndRecord = async (file, table) => {
    let randomPostfix = (Math.floor(Math.random() * 1000000) + 1).toString();
    
    let currentDir = path.dirname(new URL(import.meta.url).pathname);
    if (process.platform === 'win32') {
        currentDir = currentDir.substr(1);
    }

    let targetPath = decodeURIComponent(path.join(currentDir, `./uploads/${randomPostfix}${path.extname(file.originalname)}`));
    
    await fs.promises.rename(file.path, targetPath);
    
    const result = await pool.query(`INSERT INTO ${table} (link) VALUES ($1) RETURNING id`, [targetPath]);
    return result.rows[0].id;
};

const register = async (request, response) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const sertificate = request.files.sertificate[0];
        const insurance_contract = request.files.insurance_contract[0];
        const ward = request.files.ward[0];

        const {
            email, password, confirmPassword, fio, phone, role_id, status_id,
            sertificate_number, date_of_sert_issue,
            contract_number, date_of_cont_issue,
            ward_number, date_of_ward_issue, work_experience,
            fio_from_ecp, iin_from_ecp, email_from_ecp, city_id
        } = request.body;

        const emailExists = await isEmailExists(email);
        if (emailExists) {
            throw new Error('Email already exists.');
        }

        if (password !== confirmPassword) {
            throw new Error('Passwords do not match.');
        }

        const hashedPassword = await hashPassword(password);

        // Загрузка файлов и запись в базу данных
        const sertificateId = await saveFileAndRecord(sertificate, 'smbt_certificates');
        const insuranceContractId = await saveFileAndRecord(insurance_contract, 'smbt_insurance_contracts');
        const wardId = await saveFileAndRecord(ward, 'smbt_wards');

        // Запись данных в таблицу smbt_persons
        const personResult = await client.query(`
            INSERT INTO smbt_persons 
            (fio, phone, role_id, status_id, sertificate_id, sertificate_number, date_of_sert_issue, 
            insurance_contract_id, contract_number, date_of_cont_issue, 
            ward_id, ward_number, date_of_ward_issue, work_experience, reg_date, fio_from_ecp, iin_from_ecp, email_from_ecp, city_id) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), $15, $16, $17, $18) RETURNING id`,
            [fio, phone, role_id, status_id, sertificateId, sertificate_number, date_of_sert_issue,
            insuranceContractId, contract_number, date_of_cont_issue,
            wardId, ward_number, date_of_ward_issue, work_experience, fio_from_ecp, iin_from_ecp, email_from_ecp, city_id]);

        const personId = personResult.rows[0].id;

        // Создание пользователя в smbt_users
        await client.query(`
            INSERT INTO smbt_users 
            (email, hashed_password, person_id) 
            VALUES ($1, $2, $3)`,
            [email, hashedPassword, personId]);

        await client.query('COMMIT');

        const token = generateToken(personId);

        const { rows } = await client.query(`
            SELECT p.*, u.email, u.is_admin FROM smbt_persons p
            INNER JOIN smbt_users u ON p.id = u.person_id
            WHERE p.id = $1
        `, [personId]);
        const userData = rows[0];

        response.status(200).json({ success: true, token, user: userData, message: "Registration successful" });

    } catch (error) {
        await client.query('ROLLBACK');
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const registerSimple = async (request, response) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const {
            email, password, confirmPassword, fio, phone, role_id, status_id, city_id
        } = request.body;

        console.log(request.body)

        const emailExists = await isEmailExists(email);
        if (emailExists) {
            throw new Error('Email already exists.');
        }

        if (password !== confirmPassword) {
            throw new Error('Passwords do not match.');
        }

        const hashedPassword = await hashPassword(password);

        // Запись данных в таблицу smbt_persons
        const personResult = await client.query(`
            INSERT INTO smbt_persons 
            (fio, phone, role_id, status_id, reg_date, city_id) 
            VALUES ($1, $2, $3, $4, NOW(), $5) RETURNING id`,
            [fio, phone, JSON.stringify(role_id), status_id, city_id]);

        const personId = personResult.rows[0].id;

        // Создание пользователя в smbt_users
        await client.query(`
            INSERT INTO smbt_users 
            (email, hashed_password, person_id) 
            VALUES ($1, $2, $3)`,
            [email, hashedPassword, personId]);

        await client.query('COMMIT');

        const token = generateToken(personId);

        const { rows } = await client.query(`
            SELECT p.*, u.email FROM smbt_persons p
            INNER JOIN smbt_users u ON p.id = u.person_id
            WHERE p.id = $1
        `, [personId]);
        const userData = rows[0];

        response.status(200).json({ success: true, token, user: userData, message: "Registration successful" });

    } catch (error) {
        await client.query('ROLLBACK');
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const auth = async (request, response) => {
    const { email, password } = request.body;

    try {
        const { rows } = await pool.query('SELECT id, hashed_password, person_id, email FROM smbt_users WHERE email = $1', [email]);
        
        if (rows.length === 0) {
            throw new Error('Пользователь с таким email не найден.');
        }

        const user = rows[0];

        const isPasswordCorrect = await bcrypt.compare(password, user.hashed_password);

        if (!isPasswordCorrect) {
            throw new Error('Неверный пароль.');
        }

        const token = generateToken(user.id);

        const { rows: personsRows } = await pool.query('SELECT * FROM smbt_persons WHERE id = $1', [user.person_id]);
        let personData = personsRows[0];

        // Добавление email к personData
        personData = { ...personData, email: user.email };

        response.status(200).json({ success: true, token, user: personData });

    } catch (error) {
        console.log(error.message)
        response.status(500).json({ success: false, message: error.message });
    }
};

const updatePassword = async (request, response) => {
    const client = await pool.connect();

    try {
        const { email, password, confirmPassword } = request.body;
        console.log({email, password, confirmPassword})
        if (password && confirmPassword && password === confirmPassword) {
            await client.query('BEGIN');
            const hashedPassword = await hashPassword(password);
            
            const res = await client.query(`
                UPDATE smbt_users
                SET hashed_password = $1
                WHERE email = $2
                RETURNING person_id;
            `, [hashedPassword, email]);

            await client.query('COMMIT');

            if (res.rowCount > 0) {
                response.status(200).json({ success: true, message: "Password updated successfully" });
            } else {
                response.status(404).json({ success: false, message: "User not found or email does not match" });
            }
        } else {
            response.status(400).json({ success: false, message: "Passwords are empty or do not match" });
        }
    } catch (error) {
        await client.query('ROLLBACK');
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const editPersonData = async (request, response) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { personId, fio, phone, email, password, passwordRepeat, city_id } = request.body;
        console.log({ personId, fio, phone, email, password, passwordRepeat, city_id });

        // Обновляем данные пользователя напрямую
        await client.query(`
            UPDATE smbt_persons SET
            fio = $1,
            phone = $2,
            city_id = $4
            WHERE id = $3
        `, [fio, phone, personId, city_id]);

        // Проверка и обновление пароля, если он предоставлен и не пустой
        if (password && password === passwordRepeat) {
            const hashedPassword = await hashPassword(password);
            await client.query(`
                UPDATE smbt_users SET
                hashed_password = $1
                WHERE person_id = $2
            `, [hashedPassword, personId]);
        } else if (password) {
            response.status(400).json({ success: false, message: "Passwords do not match" });
            return;
        }

        // Обновление email в таблице smbt_users
        await client.query(`
            UPDATE smbt_users SET
            email = $1
            WHERE person_id = $2
        `, [email, personId]);

        // Получение обновленных данных пользователя
        const { rows: updatedPersonRows } = await client.query('SELECT * FROM smbt_persons WHERE id = $1', [personId]);
        let updatedPersonData = updatedPersonRows[0];
        updatedPersonData = { ...updatedPersonData, email: email };

        await client.query('COMMIT');
        response.status(200).json({ success: true, message: "Data updated successfully", user: updatedPersonData });
    } catch (error) {
        await client.query('ROLLBACK');
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const authenticateWithECP = async (request, response) => {
    const { ecpToken, sigexAuthUrl } = request.body; 

    try {
        const sigexResponse = await axios.post(sigexAuthUrl, {
            token: ecpToken,
        });

        if (sigexResponse.data && sigexResponse.data.isValid) {
            const userInfo = sigexResponse.data.user;

            const { rows } = await pool.query('SELECT * FROM smbt_users WHERE ecp_id = $1', [userInfo.ecpId]);
            if (rows.length === 0) {
                throw new Error('Пользователь с данным ЭЦП не зарегистрирован.');
            }

            const user = rows[0];

            const token = generateToken(user.id);

            response.status(200).json({ success: true, token, user: userInfo });
        } else {
            throw new Error('Невозможно аутентифицировать пользователя через ЭЦП.');
        }

    } catch (error) {
        response.status(500).json({ success: false, message: error.message });
    }
}

const getAllUsers = async (request, response) => {
    try {
        const { rows } = await pool.query('SELECT p.*, u.email, u.is_admin FROM smbt_persons p INNER JOIN smbt_users u ON p.id = u.person_id');
        

        response.status(200).json({ rows });

    } catch (error) {
        response.status(500).json({ success: false, message: error.message });
    }
    
}

const setAdminStatus = async (request, response) => {
    const client = await pool.connect();
    const { person_id } = request.body;

    console.log({person_id})

    try {
        await client.query('BEGIN');
        
        const res = await client.query(`
            UPDATE smbt_persons
            SET is_active = true
            WHERE id = $1
            RETURNING *; 
        `, [person_id]);

        await client.query('COMMIT');
        
        if (res.rowCount > 0) {
            const updatedUserData = res.rows[0];
            response.status(200).json({ success: true, user: updatedUserData, message: "User status updated successfully" });
        } else {
            response.status(404).json({ success: false, message: "User not found with provided person ID" });
        }

    } catch (error) {
        await client.query('ROLLBACK');
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const uploadAvatar = async (avatarFile) => {
    let randomPostfix = (Math.floor(Math.random() * 1000000) + 1).toString();

    let currentDir = path.dirname(new URL(import.meta.url).pathname);
    if (process.platform === 'win32') {
        currentDir = currentDir.substr(1);
    }

    let fileName = `${randomPostfix}${path.extname(avatarFile.originalname)}`;
    let avatarPath = decodeURIComponent(path.join(currentDir, './uploads', fileName));

    if (!fs.existsSync(path.join(currentDir, './uploads'))) {
        await fs.promises.mkdir(path.join(currentDir, './uploads'), { recursive: true });
    }

    await fs.promises.rename(avatarFile.path, avatarPath);

    return fileName; // Возвращаем только имя файла
};


const setUserAvatar = async (request, response) => {
    const client = await pool.connect();

    try {
        const avatarFile = request.file;
        if (!avatarFile) {
            throw new Error('Avatar file is missing in the request');
        }
        const { userId } = request.body;

        const avatarFileName = await uploadAvatar(avatarFile); // Получаем имя файла

        await client.query('BEGIN');

        const res = await client.query(`
            UPDATE smbt_persons
            SET avatar = $1
            WHERE id = $2
            RETURNING *;
        `, [avatarFileName, userId]); // Используем имя файла в запросе

        await client.query('COMMIT');

        if (res.rowCount > 0) {
            response.status(200).json({ success: true, message: "Avatar updated successfully", user: res.rows[0] });
        } else {
            response.status(404).json({ success: false, message: "User not found" });
        }
    } catch (error) {
        console.error('Error occurred:', error);
        await client.query('ROLLBACK');
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const addRequest = async (request, response) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log("Transaction started");

        const {
            owner_id, type_id, description, tz, address, price, object_type_id,
            square, review_date, review_time, order_deadline, phone, is_moving, doc_photo, kad_number,
            movableProperty, status_id, longitude, latitude, city_id
        } = request.body;

        console.log(request.body)

        let docPhotoFileName = null;
        if (request.file) {
            console.log("Uploading document photo with data:", request.file);
            docPhotoFileName = await uploadAvatar(request.file);
            console.log("Uploaded document photo name:", docPhotoFileName);
        }

        console.log({docPhotoFileName})

        let query = 'INSERT INTO smbt_requests (';
        let valuesPart = 'VALUES (';
        let values = [];
        let counter = 1;

        // Динамически добавляем параметры в запрос
        const allFields = { owner_id, type_id, description, tz, address, price, object_type_id,
            square, review_date, review_time, order_deadline, phone, is_moving, doc_photo: docPhotoFileName, kad_number,
            status_id, longitude, latitude, city_id };

        for (let field in allFields) {
            if (allFields[field] !== undefined && allFields[field] !== null) {
                query += `${field}, `;
                valuesPart += `$${counter}, `;
                values.push(allFields[field]);
                counter++;
            }
        }

        // Убираем последнюю запятую и добавляем закрывающую скобку
        query = query.slice(0, -2) + ') ';
        valuesPart = valuesPart.slice(0, -2) + ') RETURNING *';

        const finalQuery = query + valuesPart;
        console.log("Final query:", finalQuery);
        console.log("Values:", values);

        const requestResult = await client.query(finalQuery, values);
        const newRequest = requestResult.rows[0];
        console.log("Request added with ID:", newRequest.id);

        // Обработка дополнительных свойств, если они есть
        if (is_moving && movableProperty && Array.isArray(movableProperty)) {
            console.log("Processing movable property");
            newRequest.movableProperty = [];
            for (const property of movableProperty) {
                const { title, count, unit } = property;
                const movablePropertyResult = await client.query(`
                    INSERT INTO smbt_movable_property
                    (request_id, title, count, unit)
                    VALUES ($1, $2, $3, $4) RETURNING *`,
                    [newRequest.id, title, count, unit]);

                newRequest.movableProperty.push(movablePropertyResult.rows[0]);
                console.log("Added movable property:", movablePropertyResult.rows[0]);
            }
        }

        await client.query('COMMIT');
        console.log("Transaction committed");
        response.status(200).json({ success: true, message: "Request added successfully", requestData: newRequest });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Transaction rolled back due to error:', error);
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
        console.log("Database connection released");
    }
};

const getAllRequests = async (request, response) => {
    const client = await pool.connect();

    try {
        // Шаг 1: Получение всех заявок из smbt_requests
        const requestsResult = await client.query(`SELECT * FROM smbt_requests`);
        let requests = requestsResult.rows;

        // Шаг 2: Для каждой заявки получаем информацию о владельце
        for (let i = 0; i < requests.length; i++) {
            const ownerResult = await client.query(`
                SELECT * FROM smbt_persons WHERE id = $1`, 
                [requests[i].owner_id]);
            
            if (ownerResult.rows.length > 0) {
                requests[i].owner = ownerResult.rows[0]; // Добавляем информацию о владельце в свойство owner
            } else {
                requests[i].owner = null; // Если владелец не найден, устанавливаем owner в null
            }

            // Проверка наличия перемещаемого имущества
            if (requests[i].is_moving) {
                const movablePropertyResult = await client.query(`
                    SELECT * FROM smbt_movable_property 
                    WHERE request_id = $1`, 
                    [requests[i].id]);

                requests[i].movableProperty = movablePropertyResult.rows;
            } else {
                requests[i].movableProperty = [];
            }
        }

        response.status(200).json({ success: true, requests });
    } catch (error) {
        console.error('Error occurred:', error);
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const addToFavorites = async (request, response) => {
    const client = await pool.connect();

    try {
        const { person_id, request_id } = request.body;

        // Добавление записи в таблицу избранного
        const result = await client.query(`
            INSERT INTO smbt_favorites_middleware (person_id, request_id) 
            VALUES ($1, $2) RETURNING *`, 
            [person_id, request_id]);

        const favorite = result.rows[0];
        response.status(200).json({ success: true, message: "Added to favorites successfully", favorite });
    } catch (error) {
        console.error('Error occurred:', error);
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const getFavorites = async (request, response) => {
    const client = await pool.connect();

    try {
        const { person_id } = request.params;
        console.log({person_id})
        // Шаг 1: Получение id избранных заявок пользователя
        const favoritesResult = await client.query(`
            SELECT request_id FROM smbt_favorites_middleware WHERE person_id = $1`, 
            [person_id]);
        const favoriteRequestIds = favoritesResult.rows.map(row => row.request_id);
        console.log(favoriteRequestIds)
        // Шаг 2: Получение данных по каждой избранной заявке
        let favorites = [];
        for (let requestId of favoriteRequestIds) {
            const requestResult = await client.query(`
                SELECT * FROM smbt_requests WHERE id = $1`, 
                [requestId]);
            const request = requestResult.rows[0];

            if (request) {
                // Получение данных о владельце
                const ownerResult = await client.query(`
                    SELECT * FROM smbt_persons WHERE id = $1`, 
                    [request.owner_id]);
                const owner = ownerResult.rows[0] ? ownerResult.rows[0] : null;

                // Добавление информации о заявке и владельце
                favorites.push({ ...request, owner });
            }
        }
        console.log({favorites})
        response.status(200).json({ success: true, favorites });
    } catch (error) {
        console.error('Error occurred:', error);
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const removeFromFavorites = async (request, response) => {
    const client = await pool.connect();

    try {
        const { person_id, request_id } = request.params;
        console.log({ person_id, request_id })
        // Удаление записи из таблицы избранного
        const result = await client.query(`
            DELETE FROM smbt_favorites_middleware 
            WHERE person_id = $1 AND request_id = $2`, 
            [person_id, request_id]);

        if (result.rowCount > 0) {
            response.status(200).json({ success: true, message: "Removed from favorites successfully" });
        } else {
            response.status(404).json({ success: false, message: "Favorite not found" });
        }
    } catch (error) {
        console.error('Error occurred:', error);
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const getAllCities = async (request, response) => {
    try {
        const { rows } = await pool.query('SELECT * FROM smbt_cities ORDER BY name ASC');
        

        response.status(200).json({ rows });

    } catch (error) {
        response.status(500).json({ success: false, message: error.message });
    }
    
}

const addNewResponse = async (request, response) => {
    const client = await pool.connect();

    try {
        const { user_id, order_id, finish_date } = request.body;

        // Добавление записи в таблицу ответов
        const result = await client.query(`
            INSERT INTO smbt_responses (user_id, order_id, finish_date, created_at, is_approved) 
            VALUES ($1, $2, $3, NOW(), true) RETURNING *`, 
            [user_id, order_id, finish_date]);

        const newResponse = result.rows[0];
        response.status(200).json({ success: true, message: "Response added successfully", newResponse });
    } catch (error) {
        console.error('Error occurred:', error);
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const getUserResponses = async (request, response) => {
    const client = await pool.connect();

    try {
        const { user_id } = request.params;

        const result = await client.query(`
            SELECT smbt_requests.*, smbt_responses.work_status FROM smbt_requests
            JOIN smbt_responses ON smbt_requests.id = smbt_responses.order_id
            WHERE smbt_responses.user_id = $1`,
            [user_id]);

        const userRequests = result.rows;
        response.status(200).json({ success: true, userRequests });
    } catch (error) {
        console.error('Error occurred:', error);
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const getResponsesForOrder = async (request, response) => {
    const client = await pool.connect();

    try {
        const { order_id } = request.params;

        // Шаг 1: Получение всех откликов на заявку
        const responsesResult = await client.query(`
            SELECT * FROM smbt_responses WHERE order_id = $1`, 
            [order_id]);
        const responses = responsesResult.rows;

        // Шаг 2: Для каждого отклика получаем информацию о пользователе
        for (let response of responses) {
            const customerResult = await client.query(`
                SELECT fio, avatar, is_active FROM smbt_persons WHERE id = $1`, 
                [response.user_id]);

            response.customer = customerResult.rows[0] ? customerResult.rows[0] : null;
        }

        response.status(200).json({ success: true, responses });
    } catch (error) {
        console.error('Error occurred:', error);
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const uploadWorkPhoto = async (request, response) => {
    const client = await pool.connect();

    try {
        const workPhotoFile = request.file;
        if (!workPhotoFile) {
            throw new Error('Work photo file is missing in the request');
        }

        const order_id = parseInt(request.body.order_id);
        const exterminator_id = parseInt(request.body.exterminator_id);
        const image_group_id = parseInt(request.body.image_group_id) ? parseInt(request.body.image_group_id) : 1;
        const image_title = request.body.image_title;

        if (isNaN(order_id) || isNaN(exterminator_id)) {
            throw new Error('One or more numeric parameters are invalid');
        }

        const imageFileName = await uploadAvatar(workPhotoFile);

        await client.query('BEGIN');

        const res = await client.query(`
            INSERT INTO smbt_work_photos (order_id, exterminator_id, image_group_id, image_title, image)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *;
        `, [order_id, exterminator_id, image_group_id, image_title, imageFileName]);

        await client.query('COMMIT');

        response.status(200).json({ success: true, message: "Work photo uploaded successfully", photo: res.rows[0] });
    } catch (error) {
        console.error('Error occurred:', error);
        await client.query('ROLLBACK');
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const respondToResponse = async (request, response) => {
    const client = await pool.connect();

    try {
        const { response_id, approve } = request.body;

        console.log('respondToResponse', { response_id, approve })

        const is_approved = approve === true;
        const is_declined = approve === false;
        const work_status = is_approved ? 'started' : null;

        await client.query('BEGIN');

        // Обновляем статусы и время действия
        const updateQuery = `
            UPDATE smbt_responses
            SET is_approved = $1, is_declined = $2, action_datetime = NOW()${work_status ? ', work_status = $4' : ''}
            WHERE id = $3
            RETURNING *;
        `;
        const queryParams = work_status ? [is_approved, is_declined, response_id, work_status] : [is_approved, is_declined, response_id];

        const res = await client.query(updateQuery, queryParams);

        await client.query('COMMIT');

        if (res.rowCount > 0) {
            response.status(200).json({ success: true, message: "Response updated successfully", updatedResponse: res.rows[0] });
        } else {
            response.status(404).json({ success: false, message: "Response not found" });
        }
    } catch (error) {
        console.error('Error occurred:', error);
        await client.query('ROLLBACK');
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const getOrderDetails = async (request, response) => {
    const client = await pool.connect();

    try {
        const { order_id } = request.params;

        // Шаг 1: Получение информации о заказе
        const orderResult = await client.query(`
            SELECT * FROM smbt_requests WHERE id = $1`, 
            [order_id]);
        const order = orderResult.rows[0];

        if (order) {
            // Получение дополнительной информации для заказа
            const additionalInfoQueries = [
                client.query(`SELECT * FROM smbt_cities WHERE id = $1`, [order.city_id]),
                client.query(`SELECT * FROM smbt_object_types WHERE id = $1`, [order.object_type_id]),
                client.query(`SELECT * FROM smbt_types WHERE id = $1`, [order.type_id]),
                client.query(`SELECT * FROM smbt_persons WHERE id = $1`, [order.owner_id]),
                client.query(`
                    SELECT user_id FROM smbt_responses WHERE order_id = $1 AND is_approved = true`, 
                    [order_id])
            ];

            const [cityResult, objectTypeResult, typeResult, ownerResult, executorResult] = await Promise.all(additionalInfoQueries);

            order.city = cityResult.rows[0];
            order.objectType = objectTypeResult.rows[0];
            order.type = typeResult.rows[0];
            order.owner = await getPersonDetails(client, ownerResult.rows[0].id);

            if (executorResult.rows.length > 0) {
                const executorId = executorResult.rows[0].user_id;
                order.executor = await getPersonDetails(client, executorId);

                // Шаг 4: Получение фото работ и групп изображений
                const photosResult = await client.query(`
                    SELECT * FROM smbt_work_photos WHERE order_id = $1 AND exterminator_id = $2`, 
                    [order_id, executorId]);
                const photos = photosResult.rows;

                for (let photo of photos) {
                    const imageGroupResult = await client.query(`
                        SELECT * FROM smbt_image_groups WHERE id = $1`, 
                        [photo.image_group_id]);
                    photo.imageGroup = imageGroupResult.rows[0];
                }

                order.photos = photos;
            }
        }

        response.status(200).json({ success: true, order });
    } catch (error) {
        console.error('Error occurred:', error);
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

async function getPersonDetails(client, personId) {
    const personResult = await client.query(`SELECT * FROM smbt_persons WHERE id = $1`, [personId]);
    const person = personResult.rows[0];

    if (person) {
        const detailsQueries = [
            client.query(`SELECT * FROM smbt_roles WHERE id = $1`, [person.role_id]),
            client.query(`SELECT * FROM smbt_statuses WHERE id = $1`, [person.status_id]),
            client.query(`SELECT * FROM smbt_certificates WHERE id = $1`, [person.sertificate_id]),
            client.query(`SELECT * FROM smbt_insurance_contracts WHERE id = $1`, [person.insurance_contract_id]),
            client.query(`SELECT * FROM smbt_wards WHERE id = $1`, [person.ward_id]),
            client.query(`SELECT * FROM smbt_cities WHERE id = $1`, [person.city_id])
        ];

        const [roleResult, statusResult, certificateResult, insuranceResult, wardResult, cityResult] = await Promise.all(detailsQueries);

        person.role = roleResult.rows[0];
        person.status = statusResult.rows[0];
        person.certificate = certificateResult.rows[0];
        person.insurance_contract = insuranceResult.rows[0];
        person.ward = wardResult.rows[0];
        person.city = cityResult.rows[0];
    }

    return person;
}

const getAllImageGroups = async (request, response) => {
    const client = await pool.connect();

    try {
        // Получение всех записей из таблицы smbt_image_groups
        const result = await client.query(`SELECT * FROM smbt_image_groups`);

        const imageGroups = result.rows;
        response.status(200).json({ success: true, imageGroups });
    } catch (error) {
        console.error('Error occurred:', error);
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const confirmWorkCompletion = async (request, response) => {
    const client = await pool.connect();

    try {
        const { response_id } = request.body;

        await client.query('BEGIN');

        const res = await client.query(`
            UPDATE smbt_responses
            SET work_status = 'finished'
            WHERE id = $1
            RETURNING *;
        `, [response_id]);

        await client.query('COMMIT');

        if (res.rowCount > 0) {
            response.status(200).json({ success: true, message: "Work completion confirmed successfully", updatedResponse: res.rows[0] });
        } else {
            response.status(404).json({ success: false, message: "Response not found" });
        }
    } catch (error) {
        console.error('Error occurred:', error);
        await client.query('ROLLBACK');
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

const rejectWorkCompletion = async (request, response) => {
    const client = await pool.connect();

    try {
        const { response_id, reason } = request.body;

        await client.query('BEGIN');

        const res = await client.query(`
            UPDATE smbt_responses
            SET work_status = 'rejected', reject_reason = $2
            WHERE id = $1
            RETURNING *;
        `, [response_id, reason]);

        await client.query('COMMIT');

        if (res.rowCount > 0) {
            response.status(200).json({ success: true, message: "Work rejection recorded successfully", updatedResponse: res.rows[0] });
        } else {
            response.status(404).json({ success: false, message: "Response not found" });
        }
    } catch (error) {
        console.error('Error occurred:', error);
        await client.query('ROLLBACK');
        response.status(500).json({ success: false, message: error.message });
    } finally {
        client.release();
    }
};

export default {
    register,
    registerSimple,
    auth,
    updatePassword,
    editPersonData,
    authenticateWithECP,
    getAllUsers,
    setAdminStatus,
    uploadAvatar,
    setUserAvatar,
    addRequest,
    getAllRequests,
    addToFavorites,
    getFavorites,
    removeFromFavorites,
    getAllCities,
    addNewResponse,
    getUserResponses,
    getResponsesForOrder,
    uploadWorkPhoto,
    respondToResponse,
    getOrderDetails,
    getAllImageGroups,
    confirmWorkCompletion,
    rejectWorkCompletion
}