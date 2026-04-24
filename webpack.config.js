const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  entry: {
    content: './src/content.js',
    background: './src/background.js',
    'popup/popup': './src/popup/popup.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  plugins: [
    // Chrome extension content scripts cannot dynamically load chunk files
    // at runtime. Force webpack to emit every entry as a single file, inlining
    // any dynamic import() calls (mermaid relies on these internally).
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    new MiniCssExtractPlugin({
      filename: '[name].css',
    }),
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'icons', to: 'icons' },
        { from: 'src/popup/popup.html', to: 'popup/popup.html' },
        { from: 'src/themes', to: 'themes' },
        {
          from: 'node_modules/katex/dist/fonts',
          to: 'katex/fonts',
        },
        {
          from: 'node_modules/katex/dist/katex.min.css',
          to: 'katex/katex.min.css',
        },
      ],
    }),
  ],
  resolve: {
    extensions: ['.js'],
  },
  optimization: {
    splitChunks: false,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          output: {
            ascii_only: true,  // Escape non-ASCII to \uXXXX — required for Chrome extension UTF-8 validation
          },
        },
      }),
    ],
  },
};
