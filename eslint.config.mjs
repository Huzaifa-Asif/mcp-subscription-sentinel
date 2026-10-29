import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, { ignores: ['dist/**', 'coverage/**'] }, { files: ['**/*.mjs'], languageOptions: { globals: { console: 'readonly', URL: 'readonly' } } });
