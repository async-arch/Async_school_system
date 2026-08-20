from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase


class TestUserValidation(TransactionCase):
    """Covers the email/password rules added with the attendance work."""

    def _create(self, **vals):
        vals.setdefault('name', vals['login'])
        return self.env['res.users'].create(vals)

    def test_username_login_without_email_is_accepted(self):
        """Odoo logins are usernames, not addresses. Every role fixture in this
        suite creates one, so validating login-as-email breaks the whole suite."""
        user = self._create(login='val_plain_username')
        self.assertTrue(user.id)

    def test_malformed_email_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._create(login='val_bad_email', email='not-an-address')

    def test_valid_email_is_accepted(self):
        user = self._create(login='val_good_email', email='val@school.example')
        self.assertEqual(user.email, 'val@school.example')

    def test_weak_password_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._create(login='val_weak_password', password='password')

    def test_strong_password_is_accepted(self):
        user = self._create(login='val_strong_password', password='Str0ng!pass')
        self.assertTrue(user.id)
