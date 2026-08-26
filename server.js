const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Uploads Folder Auto Create Check
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// MongoDB Connection String
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://usernametareq_db_user:BOaae2HMvEh7n9Bz@cluster0.gmubyza.mongodb.net/moviehouse?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log('🟢 MongoDB Connected Successfully!'))
    .catch(err => console.error('🔴 MongoDB Connection Error:', err));

// Middleware & View Engine Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer Config for Image Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Database Schemas & Models
const settingsSchema = new mongoose.Schema({
    adminPassword: { type: String, default: "admin" },
    categories: { type: [String], default: ["Drama", "Action", "Hindi Movie", "Bangla Movie", "Thriller"] },
    subcategories: [{
        name: String,
        parentCategory: String
    }]
});

const movieSchema = new mongoose.Schema({
    title: String,
    category: String,
    subcategory: String,
    poster: String,
    videoLinks: [{ name: String, url: String }],
    isPinned: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const Settings = mongoose.model('Settings', settingsSchema);
const Movie = mongoose.model('Movie', movieSchema);

async function getSettings() {
    let settings = await Settings.findOne();
    if (!settings) {
        settings = await Settings.create({});
    }
    return settings;
}

let isLoggedAdmin = true;

function isAdmin(req, res, next) {
    if (isLoggedAdmin) {
        next();
    } else {
        res.redirect('/admin/login');
    }
}

// Frontend Routes

// Home Page Route
app.get('/', async (req, res) => {
    try {
        const settings = await getSettings();
        const selectedCategory = req.query.category || '';
        const selectedSubcategory = req.query.sub || '';
        
        let query = { isPinned: false };
        if (selectedCategory) {
            query.category = selectedCategory;
        }
        if (selectedSubcategory) {
            query.subcategory = selectedSubcategory;
        }

        const pinnedMovies = await Movie.find({ isPinned: true }).sort({ createdAt: -1 });
        const latestMovies = await Movie.find(query).sort({ createdAt: -1 });
        
        res.render('index', {
            categories: settings.categories,
            subcategories: settings.subcategories || [],
            pinnedMovies,
            latestMovies,
            selectedCategory,
            selectedSubcategory
        });
    } catch (err) {
        res.status(500).send("Error loading home page.");
    }
});

// Single Movie Stream Page
app.get('/movie/:id', async (req, res) => {
    try {
        const movie = await Movie.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
        if (!movie) return res.status(404).send('Movie not found');

        const relatedMovies = await Movie.find({ 
            category: movie.category, 
            _id: { $ne: movie._id } 
        }).limit(6);

        res.render('movie', { movie, relatedMovies });
    } catch (err) {
        res.status(500).send("Error loading movie page.");
    }
});

// Search Route
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q || '';
        const movies = await Movie.find({ 
            title: { $regex: query, $options: 'i' } 
        });

        res.render('search', { movies, query });
    } catch (err) {
        res.status(500).send("Error performing search.");
    }
});

// Admin Panel Routes

app.get('/admin', isAdmin, async (req, res) => {
    try {
        const settings = await getSettings();
        const movies = await Movie.find().sort({ createdAt: -1 });
        const movieToEdit = req.query.edit ? await Movie.findById(req.query.edit) : null;

        res.render('admin', {
            categories: settings.categories,
            subcategories: settings.subcategories || [],
            movies,
            movieToEdit,
            msg: req.query.msg || null,
            err: req.query.err || null
        });
    } catch (err) {
        res.status(500).send("Error loading admin panel.");
    }
});

app.post('/admin/save-movie', isAdmin, upload.single('posterFile'), async (req, res) => {
    try {
        const { id, title, category, subcategory, posterUrl, linkUrl, isPinned } = req.body;

        let poster = posterUrl;
        if (req.file) {
            poster = '/uploads/' + req.file.filename;
        }

        const videoLinks = [{ name: 'Server 1', url: linkUrl }];

        if (id) {
            const updateData = {
                title,
                category,
                subcategory: subcategory || '',
                videoLinks,
                isPinned: isPinned === 'on'
            };
            if (poster) updateData.poster = poster;
            await Movie.findByIdAndUpdate(id, updateData);
        } else {
            await Movie.create({
                title,
                category,
                subcategory: subcategory || '',
                poster: poster || 'https://via.placeholder.com/300x400?text=No+Poster',
                videoLinks,
                isPinned: isPinned === 'on'
            });
        }

        res.redirect('/admin?msg=Movie+saved+successfully!');
    } catch (err) {
        res.redirect('/admin?err=Error+saving+movie');
    }
});

app.post('/admin/add-subcategory', isAdmin, async (req, res) => {
    try {
        const { subcategoryName, parentCategory } = req.body;
        const settings = await getSettings();

        if (subcategoryName && parentCategory) {
            const exists = settings.subcategories.some(
                sub => sub.name.toLowerCase() === subcategoryName.toLowerCase() && sub.parentCategory === parentCategory
            );
            if (!exists) {
                settings.subcategories.push({ name: subcategoryName, parentCategory });
                await settings.save();
            }
        }
        res.redirect('/admin?msg=Subcategory+added!');
    } catch (err) {
        res.redirect('/admin?err=Failed+to+add+subcategory');
    }
});

app.post('/admin/delete-subcategory', isAdmin, async (req, res) => {
    try {
        const { subcategoryId } = req.body;
        const settings = await getSettings();
        settings.subcategories = settings.subcategories.filter(sub => sub._id.toString() !== subcategoryId);
        await settings.save();
        res.redirect('/admin?msg=Subcategory+deleted!');
    } catch (err) {
        res.redirect('/admin?err=Failed+to+delete+subcategory');
    }
});

app.post('/admin/toggle-pin/:id', isAdmin, async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);
        if (movie) {
            movie.isPinned = !movie.isPinned;
            await movie.save();
        }
        res.redirect('/admin');
    } catch (err) {
        res.redirect('/admin');
    }
});

app.post('/admin/delete-movie/:id', isAdmin, async (req, res) => {
    try {
        await Movie.findByIdAndDelete(req.params.id);
        res.redirect('/admin?msg=Movie+deleted!');
    } catch (err) {
        res.redirect('/admin?err=Failed+to+delete+movie');
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
