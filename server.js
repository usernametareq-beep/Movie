require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const session = require('express-session');

const app = express();

// 1. MongoDB Connection Setup
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/moviehouse';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// 2. Mongoose Schema Setup (Data compatibility intact)
const movieSchema = new mongoose.Schema({
  title: { type: String, required: true },
  contentType: { type: String, default: 'movie' }, // 'movie' or 'series'
  category: { type: String, required: true },
  poster: { type: String, default: '' },
  videoLinks: [{
    name: String,
    url: String
  }],
  episodes: [{
    season: Number,
    episodeNumber: Number,
    name: String,
    url: String
  }],
  isPinned: { type: Boolean, default: false },
  views: { type: Number, default: 0 }
}, { timestamps: true });

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }
});

const Movie = mongoose.model('Movie', movieSchema);
const Category = mongoose.model('Category', categorySchema);

// 3. Middlewares & Configurations
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'secretkey123',
  resave: false,
  saveUninitialized: true
}));

// Multer Storage Setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const isAdmin = (req, res, next) => {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
};

// 4. Public Routes
app.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const selectedCategory = req.query.category || 'All';
    const searchQuery = req.query.search || '';

    let filter = {};
    if (selectedCategory !== 'All') filter.category = selectedCategory;
    if (searchQuery) filter.title = new RegExp(searchQuery, 'i');

    const totalMovies = await Movie.countDocuments(filter);
    const totalPages = Math.ceil(totalMovies / limit);

    const movies = await Movie.find(filter)
      .sort({ isPinned: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const popularMovies = await Movie.find().sort({ views: -1 }).limit(5);
    const categoriesData = await Category.find().distinct('name');

    res.render('index', {
      movies,
      popularMovies,
      categories: categoriesData,
      selectedCategory,
      searchQuery,
      currentPage: page,
      totalPages
    });
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

app.get('/movie/:id', async (req, res) => {
  try {
    const movie = await Movie.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
    if (!movie) return res.redirect('/');
    
    const relatedMovies = await Movie.find({ category: movie.category, _id: { $ne: movie._id } }).limit(6);
    res.render('movie-details', { movie, relatedMovies });
  } catch (err) {
    res.redirect('/');
  }
});

// 5. Admin Authentication Routes
app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  if (req.body.password === adminPassword) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin-login', { error: 'Invalid Password' });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// 6. Admin Panel Routes
app.get('/admin', isAdmin, async (req, res) => {
  try {
    const movies = await Movie.find().sort({ createdAt: -1 });
    const categoriesData = await Category.find().distinct('name');
    
    let movieToEdit = null;
    if (req.query.edit) {
      movieToEdit = await Movie.findById(req.query.edit);
    }

    res.render('admin-dashboard', {
      movies,
      categories: categoriesData.length ? categoriesData : ['Action', 'Drama', 'Comedy'],
      movieToEdit,
      msg: req.query.msg || null,
      err: req.query.err || null
    });
  } catch (err) {
    res.status(500).send('Admin Panel Error');
  }
});

app.post('/admin/save-movie', isAdmin, upload.single('posterFile'), async (req, res) => {
  try {
    const { id, contentType, title, category, posterUrl, isPinned, linkName, linkUrl, epSeason, epNum, epName, epUrl } = req.body;
    
    let poster = posterUrl || '';
    if (req.file) {
      poster = '/uploads/' + req.file.filename;
    }

    let videoLinks = [];
    if (contentType === 'movie' && linkName) {
      const names = Array.isArray(linkName) ? linkName : [linkName];
      const urls = Array.isArray(linkUrl) ? linkUrl : [linkUrl];
      videoLinks = names.map((name, i) => ({ name, url: urls[i] }));
    }

    let episodes = [];
    if (contentType === 'series' && epName) {
      const seasons = Array.isArray(epSeason) ? epSeason : [epSeason];
      const nums = Array.isArray(epNum) ? epNum : [epNum];
      const names = Array.isArray(epName) ? epName : [epName];
      const urls = Array.isArray(epUrl) ? epUrl : [epUrl];
      episodes = names.map((name, i) => ({
        season: Number(seasons[i]),
        episodeNumber: Number(nums[i]),
        name,
        url: urls[i]
      }));
    }

    const payload = {
      title,
      contentType,
      category,
      isPinned: isPinned === 'on',
      videoLinks,
      episodes
    };
    if (poster) payload.poster = poster;

    if (id) {
      await Movie.findByIdAndUpdate(id, payload);
    } else {
      await Movie.create(payload);
    }

    res.redirect('/admin?msg=Content Saved Successfully');
  } catch (err) {
    res.redirect('/admin?err=Failed to Save Content');
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
    res.redirect('/admin?msg=Content Deleted');
  } catch (err) {
    res.redirect('/admin?err=Delete Failed');
  }
});

app.post('/admin/add-category', isAdmin, async (req, res) => {
  try {
    if (req.body.categoryName) {
      await Category.create({ name: req.body.categoryName.trim() });
    }
    res.redirect('/admin?msg=Category Added');
  } catch (err) {
    res.redirect('/admin?err=Category Exists or Invalid');
  }
});

app.post('/admin/delete-category', isAdmin, async (req, res) => {
  try {
    await Category.findOneAndDelete({ name: req.body.categoryName });
    res.redirect('/admin?msg=Category Removed');
  } catch (err) {
    res.redirect('/admin?err=Failed to Delete Category');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
