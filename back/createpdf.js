import pg from 'pg';
import moment from 'moment'
moment.locale('ru');
import { productionPoolOptions, secretKey, transporter } from './accesses.js';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import axios from 'axios';

import pdfkit from 'pdfkit';
import { Sign } from 'crypto';

const Pool = pg.Pool
const pool = new Pool(productionPoolOptions);



const getReportDataForPDF = async (reportId) => {
    const client = await pool.connect();
    try {
        const reportQuery = `
            SELECT r.*, 
                   array_agg(l.photo) as lpo_photos,
                   req.address as object_address,
                   p.fio as exterminator_fio
            FROM smbt_reports r
            LEFT JOIN smbt_lpo_identity_cards l ON r.id = l.report_id
            LEFT JOIN smbt_requests req ON r.request_id = req.id
            LEFT JOIN smbt_persons p ON r.exterminator_id = p.id
            WHERE r.request_id = $1
            GROUP BY r.id, req.address, p.fio;
        `;
        const reportResult = await client.query(reportQuery, [parseInt(reportId)]);
        if (reportResult.rows.length === 0) {
            throw new Error('Report not found');
        }
        return reportResult.rows[reportResult.rows.length - 1];
    } catch (error) {
        console.error('Error occurred:', error);
        throw error; // Пробрасываем ошибку дальше
    } finally {
        client.release();
    }
};

const getPhotosByCategoriesForPDF = async (requestId) => {
    const client = await pool.connect();
    requestId = parseInt(requestId); // Убедитесь, что requestId - это число
    const baseUrl = "uploads/"; // Укажите здесь базовый URL для изображений

    try {
        const categories = await client.query('SELECT * FROM smbt_group_categories');
        let result = [];

        for (const category of categories.rows) {
            let categoryData = {
                category_id: category.id,
                category_title: category.title,
                items: []
            };

            if (category.id != 4 && category.id != 5) {
                const imageGroups = await client.query('SELECT * FROM smbt_image_groups WHERE category_id = $1', [category.id]);
                for (const group of imageGroups.rows) {
                    const photos = await client.query('SELECT * FROM smbt_work_photos WHERE order_id = $1 AND image_group_id = $2 AND group_category_id = $3', [requestId, group.id, category.id]);
                    categoryData.items.push({
                        group_id: group.id,
                        group_title: group.title,
                        photos: photos.rows.map(photo => ({
                            ...photo,
                            image: `${baseUrl}${photo.image}` // Модификация здесь
                        }))
                    });
                }
            } else if (category.id === 4) {
                const movableProperties = await client.query('SELECT * FROM smbt_movable_property WHERE request_id = $1', [requestId]);
                for (const property of movableProperties.rows) {
                    const photos = await client.query('SELECT * FROM smbt_work_photos WHERE order_id = $1 AND movable_property_id = $2 AND group_category_id = $3', [requestId, property.id, category.id]);
                    categoryData.items.push({
                        property_id: property.id,
                        property_title: property.title,
                        photos: photos.rows.map(photo => ({
                            ...photo,
                            image: `${baseUrl}${photo.image}` // Модификация здесь
                        }))
                    });
                }
            } else if (category.id === 5) {
                const photos = await client.query('SELECT * FROM smbt_work_photos WHERE order_id = $1 AND group_category_id = $2', [requestId, category.id]);
                categoryData.items = photos.rows.map(photo => ({
                    ...photo,
                    image: `${baseUrl}${photo.image}` // Модификация здесь
                }));
            }

            result.push(categoryData);
        }

        return result; // Возвращаем результат напрямую
    } catch (error) {
        console.error('Error occurred:', error);
        throw error; // Пробрасываем ошибку для обработки на более высоком уровне
    } finally {
        client.release();
    }
};




function getCurrentDateFormatted() {
    const currentDate = new Date(); // Получаем текущую дату

    // Получаем день, месяц и год
    const day = String(currentDate.getDate()).padStart(2, '0'); // Добавляем ведущий ноль, если нужно
    const month = String(currentDate.getMonth() + 1).padStart(2, '0'); // Месяцы начинаются с 0
    const year = currentDate.getFullYear();

    // Формируем строку в нужном формате
    return `${day}.${month}.${year}`;
}


const createPdf = async (req, res) => {

    try {
        const reqId = req.params.reqId; // или откуда вы получаете reqId

        // Получаем данные отчета
        const reportData = await getReportDataForPDF(reqId);
        if (!reportData) {
            // Если данные отчета не найдены, отправляем ответ об ошибке
            return res.status(404).send({message: 'Данные отчета по данному запросу не найдены'});
        }

        // Получаем фотографии по категориям
        const photoData = await getPhotosByCategoriesForPDF(reqId);
        if (!photoData || photoData.length === 0) {
            // Если фотографии не найдены, отправляем ответ об ошибке
            return res.status(404).send({message: 'Фотографии по данному запросу не найдены'});
        }
    
    



    // Создаем новый PDF документ
    const doc = new pdfkit({
        size: 'A4',
        margin: 10
    });
    
    console.log(reportData, photoData);
    // Устанавливаем заголовок и тип содержимого для ответа
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="generated.pdf"');

    // Подключаем поток ответа к PDF документу
    doc.pipe(res);

    const Ispolnitel = reportData.exterminator_fio; // Предполагаем, что текст передается в теле запроса как { text: "Текст здесь" }
    const Date = getCurrentDateFormatted();
    const Address = reportData.object_address;
    const actAddress = reportData.bordering_streets;
    const sosedAddres = reportData.bordering_streets;
    const hisName = reportData.historical_name;
    const gradeTrans = reportData.transport_availability;
    const School = reportData.nearest_educational;
    const torCulCenter = reportData.nearest_shopping;
    const GradeEcologZone = reportData.eco_state;
    
    const EcoZone1 = reportData.has_parks ? "Парк" : "";
    const EcoZone2 = reportData.has_public_gardens ? "Сквер" : "";
    const EcoZone3 = reportData.has_alleys ? "Аллеи" : "";
    const EcoZone4 = reportData.has_walking_areas ? "Прогулочные Зоны" : "";
    const EcoZone5 = reportData.has_coastal_area ? "Прибрежная Зона" : "";
    const ecoZonesString = [EcoZone1, EcoZone2, EcoZone3, EcoZone4, EcoZone5].filter(Boolean).join(", ");
    
    const HomeLocation = reportData.house_location;
    const ChildZone = reportData.has_playground ? "Есть" : "Нет";
    const CleanTerr = reportData.surrounding_area_cleanliness;
    const Nasazh = reportData.plantings_availability;
    const MaterSten = reportData.wall_material;
    const SostKrovl = reportData.roof_condition;
    const VneshObshSten = reportData.external_wall_cladding;
    
    const BlizhSpesUdob1 = reportData.has_parking ? "Паркинг" : "";
    const BlizhSpesUdob2 = reportData.has_shop ? "Магазин" : "";
    const BlizhSpesUdob3 = reportData.has_market ? "Рынок" : "";
    const BlizhSpesUdob4 = reportData.has_bus_stop ? "Остановка" : "";
    const BlizhSpesUdob5 = reportData.has_coastal_area ? "Прибрежная Зона" : "";
    const BlizhSpesString = [BlizhSpesUdob1, BlizhSpesUdob2, BlizhSpesUdob1, BlizhSpesUdob4, BlizhSpesUdob5].filter(Boolean).join(", ");
    const BlizhSpesUdob = reportData.BlizhSpesString;
    
    const SostVneshObsh = reportData.outer_skin_condition;
    const Santeh = reportData.plumbing;
    const Krovlya = reportData.roof;
    const Podezd = reportData.entrance;
    const Gas = reportData.gas;

    const NezhilEtazh = reportData.has_non_residential_floors ? "Есть" : "Нет";

    const HolVod = reportData.cold_water_supply;
    const Podval = reportData.has_cellars ? "Есть" : "";
    const GorVod = reportData.hot_water_supply;
    const Cherdak = reportData.has_attics ? "Есть" : "Нет";
    const Canal = reportData.sewerage;
    const KolKom = reportData.rooms;
    const Etazh = reportData.floor;
    const KolEtazh =reportData.number_of_storeys;
    const Year = reportData.year_of_construction;
    const Plosh = reportData.site_area;
    const ZhilPlosh = reportData.total_area;
    const KuhPLosh = reportData.kitchen_area;
    const WindowGoOut = reportData.the_windows_go_out;
    const Loggia = reportData.loggia ? "Есть" : "";
    const Noisy = reportData.noisy_location ? "Высокая" :"Низкая";
    const MajorOverhaul = reportData.last_major_overhaul;
    const Windows = reportData.windows;
    const Phone = reportData.has_phone ? "Есть" :"Нет";
    const Ground = reportData.ground;
    const Signal = reportData.has_signaling ? "Есть" :"Нет";
    const WallDecor = reportData.wall_decoration;
    const Redev = reportData.has_redevelopment ? "Была" :"Нет";
    const PlumbingCond = reportData.plumbing_condition;

    const Sec1 = reportData.has_parks ? "Пожарная" : "Нет";
    const Sec2 = reportData.has_public_gardens ? "Охранная" : "Нет";
    const Secure = [Sec1, Sec2].filter(Boolean).join(", ");    

    const Balcony = reportData.balcony ? "Да" : "Нет";


    // Регистрация шрифтов
    doc.registerFont('ExtraLight', 'fonts/Nunito_Sans/NunitoSans_7pt-ExtraLight.ttf');
    doc.registerFont('Light', 'fonts/Nunito_Sans/NunitoSans_7pt-Light.ttf');
    doc.registerFont('Regular', 'fonts/Nunito_Sans/NunitoSans_7pt-Regular.ttf');
    doc.registerFont('Medium', 'fonts/Nunito_Sans/NunitoSans_7pt-Medium.ttf');
    doc.registerFont('SemiBold', 'fonts/Nunito_Sans/NunitoSans_7pt-SemiBold.ttf');
    doc.registerFont('Bold', 'fonts/Nunito_Sans/NunitoSans_7pt-Bold.ttf');
    doc.registerFont('ExtraBold', 'fonts/Nunito_Sans/NunitoSans_7pt-ExtraBold.ttf');
    doc.registerFont('Black', 'fonts/Nunito_Sans/NunitoSans_7pt-Black.ttf');

    doc.font('Regular');

    let position = { x: 35, y: 500 };
    let image = { x: 35, y: 530 }; // Начальная позиция для изображений, предполагаем что изображения идут после некоторого текста

    // Добавляем содержимое в PDF документ

    doc
        .fillColor('#94A3B8')
        .text('Исполнитель', 35, 30);

    doc.image('mock_images/avatar.png', 35, 55, {width: 30});

    doc
        .fillColor('#3F444A')
        .fontSize(16)
        .font('SemiBold')
        .text(Ispolnitel, 75, 58);

    doc
        .roundedRect(340, 30, 220, 60, 16)
        .strokeColor('#92E3A9')
        .stroke();

    doc
        .fontSize(14)
        .fillColor('#3F444A')
        .font('SemiBold')
        .text('Дата завершения осмотра', 350, 39);

    doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Medium')
        .text(Date, 350, 62);

    doc
        .fontSize(28)
        .fillColor('#09C18A')
        .font('Bold')
        .text('Место осмотра на карте', 35, 110);

    doc
        .fontSize(16)
        .fillColor('#3F444A')
        .font('Regular')
        .text(Address, 35, 160);

    doc.image('mock_images/map.png', 35, 190, {width: 525});

    doc
        .fontSize(28)
        .fillColor('#09C18A')
        .font('Bold')
        .text('Фотографии объекта', 35, 450);

        function addImage(imageUrl, position) {
            if (position.y > 700) { // Проверяем, нужна ли новая страница
                doc.addPage();
                position.x = 50;
                position.y = 50;
            }
        
            doc.image(imageUrl, position.x, position.y, { width: 125, height: 90 });
            position.x += 135; // Сдвигаем позицию по X для следующего изображения
        
            // Переход на новую строку, если достигнут конец страницы по X
            if (position.x > 480) {
                position.x = 50; // Сброс X к началу строки
                position.y += 98; // Переход на следующую строку
            }
        }
        
        photoData.forEach(category => {
            let hasPhotos = category.items.some(item => item.photos && item.photos.length > 0);
        
            if (hasPhotos) {
                // position.x = 50; // Явно сбрасываем position.x к началу строки перед заголовком категории
                doc.fontSize(22).fillColor('black').font('Bold').text(category.category_title, position.x, position.y);
                position.y += 30; // Отступ после заголовка категории
        
                category.items.forEach(item => {
                    if (item.photos && item.photos.length > 0) {

        
                        item.photos.forEach(photo => {
                            addImage(photo.image, position); // Добавляем фотографию
                        });

                    }
                });
                position.x = 35; // Сбрасываем position.x к началу строки перед добавлением новой категории
                position.y += 120;// Отступ перед следующей категорией


            }
        });



    doc.addPage();

    // Добавление прочей текстовой информации

    doc
        .fontSize(28)
        .fillColor('#09C18A')
        .font('Bold')
        .text('Акт осмотра недвижимости (квартира)', 35, 35);

    doc
        .fontSize(20)
        .fillColor('#09C18A')
        .font('SemiBold')
        .text('Адрес', 35, 130);

    doc.image('icons/location.png', 35, 165, {width: 20});

    doc
        .fontSize(14)
        .fillColor('#3F444A')
        .font('Regular')
        .text(actAddress, 65, 167);

    doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Граничащие и соседние улицы', 35, 220);

    doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(sosedAddres, 35, 240);

    doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Историческое название района', 330, 220);

    doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(hisName, 330, 240);

    doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Доступность общественного транспорта', 35, 270);

    doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(gradeTrans, 35, 290);

    doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Ближайшие учебные учреждения', 330, 270);

    doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(School, 330, 290);

    doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Ближайшие торговые и культурные центры', 35, 320, {
            width: 250
        });

    doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(torCulCenter, 35, 360);

    doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Состояние экологической зоны', 330, 320);

    doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(GradeEcologZone, 330, 340);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Экологические Зоны', 330, 360, {
        });

        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(ecoZonesString, 330, 380);




        position.y += 30; 


        doc
        .fontSize(20)
        .fillColor('#09C18A')
        .font('SemiBold')
        .text('Местоположение дома', 34, 400);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Дом Расположен', 35, 440, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(HomeLocation, 35, 460);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Детская площадка', 330, 440, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(ChildZone, 330, 460);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Чистота прилегающей территории', 35, 480, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(CleanTerr, 35, 500);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Наличие насаждений', 330, 480, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Nasazh, 330, 500);

        doc
        .fontSize(20)
        .fillColor('#09C18A')
        .font('SemiBold')
        .text('Характеристика дома', 34, 525);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Материал стен', 35, 560, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(MaterSten, 35, 580);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Состояние кровли', 330, 560, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(SostKrovl, 330, 580);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Внешняя обшивка стен', 35, 600, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(VneshObshSten, 35, 620);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Ближайшие спец.удобства', 330, 600, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(BlizhSpesUdob, 330, 620);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Состояние внешней обшивки', 35, 640, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(SostVneshObsh, 35, 660);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Сантехника(состояние в целом по дому)', 330, 640, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Santeh, 330, 660);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Кровля', 35, 680, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Krovlya, 35, 700);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Подъезд', 330, 680, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Podezd, 330, 700);

        doc.addPage();

        doc
        .fontSize(20)
        .fillColor('#09C18A')
        .font('SemiBold')
        .text('Коммуникации', 34, 30);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Газ', 35, 60, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Gas, 35, 80);


        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Наличие нежилих этажей', 330, 60, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(NezhilEtazh, 330, 80);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Холодное водоснабжение', 35, 100, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(HolVod, 35, 120);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Наличие подвальных помещений', 330, 100, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Podval, 330, 120);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Горячее водоснабжение', 35, 140, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(GorVod, 35, 160);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Наличие чердачных помещещний', 330, 140, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Cherdak, 330, 160);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Канализация', 35, 180, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Canal, 35, 200);

        doc
        .fontSize(20)
        .fillColor('#09C18A')
        .font('SemiBold')
        .text('Характеристика квартиры', 34, 220);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Количество комнат', 35, 260, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(KolKom, 35, 280);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Этаж', 170, 260, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Etazh, 170, 280);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Этажность', 305, 260, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(KolEtazh, 305, 280);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Год постройки', 440, 260, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Year, 440, 280);


        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Общая пл., м²', 35, 320, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Plosh, 35, 340);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Жилая пл., м²', 170, 320, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(ZhilPlosh, 170, 340);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Кухня пл., м²', 305, 320, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(KuhPLosh, 305, 340);




        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Окна выходят', 35, 380, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(WindowGoOut, 35, 400);


        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Лоджия', 330, 380, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Loggia, 330, 400);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Шумность расположения', 35, 420, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Noisy, 35, 440);

        doc
        .fontSize(12) 
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Год последнего кап. ремонта', 330, 420, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(MajorOverhaul, 330, 440);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Окна', 35, 460, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Windows, 35, 480);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Телефон', 330, 460, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Phone, 330, 480);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Пол', 35, 500, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Ground, 35, 520);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Сигнализация', 330, 500, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Signal, 330, 520);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Отделка стен', 35, 540, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(WallDecor, 35, 560);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Перепланировка', 330, 540, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Redev, 330, 560);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Сантехника (состояние)', 35, 580, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(PlumbingCond, 35, 600);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Сигнализация', 330, 580, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Secure, 330, 600);

        doc
        .fontSize(12)
        .fillColor('#94A3B8')
        .font('Regular')
        .text('Балкон застеклен', 35, 620, {
        });
        
        doc
        .fontSize(14)
        .fillColor('#50575E')
        .font('Regular')
        .text(Balcony, 35, 640);

        doc.addPage();


        doc
        .fontSize(28)
        .fillColor('#09C18A')
        .font('Bold')
        .text('Документы', 35, 30);



    const photoSec = [
        {
            img: 7
        }
    ];

    // Добавление изображений

    let 
        img = {x: 35, y: 80};

    photoSec.forEach(photoSecs => {
        doc
            .fontSize(16)
            .fillColor('#3F444A')
            .font('SemiBold')

        for (let i = 0; i < photoSecs.img; i++) {
            doc.image('mock_images/object-photo.png', img.x, img.y, {
                width: 125,
                height: 90
            });

            if ((i === 3 || i === 7 || i === 11 || i === 15) && photoSecs.img > 4) {
                img.x = 35;
                img.y += 98;
            } else {
                img.x += 133;
            }
        }

        if (img.y > 650) {
            doc.addPage();

            img.x = 35;
            img.y = 65;
        } else {
            image.x = 35;
            image.y += 150;
        }
    });

    doc
    .fontSize(20)
    .fillColor('#09C18A')
    .font('SemiBold')
    .text('Удостоверение Личности', 34, 300);

    doc
    .fontSize(12)
    .fillColor('#94A3B8')
    .font('Regular')
    .text('(лица присутствовавщего при осмотре)', 34, 320, {
    });

    const photoSec1 = [
        {
            img: 2, // Общее количество изображений
            // Предполагаем, что у нас есть два пути к изображениям для чередования
            paths: ['uploads/1.jpg', 'uploads/2.jpg']
        }
    ];
    
    // Инициализация начальной позиции для изображений
    let imgPosition = { x: 35, y: 340 };
    
    photoSec1.forEach(section => {
        for (let i = 0; i < section.img; i++) {
            // Выбираем изображение в зависимости от четности индекса i
            const imagePath = section.paths[i % 2]; // Чередование между двумя путями изображений
    
            doc.image(imagePath, imgPosition.x, imgPosition.y, {
                width: 170,
                height: 120
            });
    
            // Проверяем, нужно ли переходить на новую строку после каждых 4 изображений
            if ((i + 1) % 4 === 0 && section.img > 4) {
                imgPosition.x = 35; // Сброс позиции X к началу строки
                imgPosition.y += 98; // Переход на следующую строку
            } else {
                imgPosition.x += 180; // Сдвигаем позицию X для следующего изображения
            }
        }
    
        // Проверяем, необходимо ли добавить новую страницу, если достигли нижней границы страницы
        if (imgPosition.y > 650) {
            doc.addPage(); // Добавление новой страницы
    
            // Сброс позиций для новой страницы
            imgPosition.x = 35;
            imgPosition.y = 65;
        } else {
            // Подготовка позиций для следующего раздела изображений
            imgPosition.x = 35;
            imgPosition.y += 150; // Предполагаем, что между разделами изображений будет дополнительный вертикальный отступ
        }
    });

    
    // Завершаем PDF и закрываем поток ответа
    doc.end();
} catch (error) {
    // Обработка других возможных ошибок
    console.error(error);
    return res.status(500).send({message: 'Произошла ошибка при генерации отчета'});
}
}

export default {
    createPdf
}