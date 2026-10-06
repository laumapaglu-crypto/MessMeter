insert into public.hostels(name, strength, type)
values ('Shivalik Demo Hostel', 250, 'boys')
on conflict do nothing;

insert into public.menu_items(weekday, slot, main_dish, full_text, options, nonveg_item, popularity)
values
(1,'breakfast','Aloo paratha','Aloo paratha + butter chiplet + milk + seasonal fruit + tea + green sauce','{}',null,60),
(1,'lunch','Rice + arhar dal','Rice + arhar dal + mix veg + salad + chapati','{}',null,60),
(1,'snacks','Poha','Poha + tea + tomato sauce','{}',null,60),
(1,'dinner','Rice + dal','Rice + chapati + lal malka dal + seasonal veg / bhindi fry + nariyal ladoo','{"seasonal veg","bhindi fry"}',null,60),

(2,'breakfast','Aloo tamatar ki sabzi','Aloo tamatar ki sabzi + poori + tea + milk + seasonal fruit + pickle','{}',null,60),
(2,'lunch','Rajma masala','Rice + rajma masala + aloo matar + raita + chapati','{}',null,60),
(2,'snacks','Samosa','Samosa + tea + saunth chutney','{}',null,60),
(2,'dinner','Urad chhilka','Rice + urad chhilka + chana dal mix + kathal ki sabji with gravey / seasonal veg + chapati + gulab jamun','{"kathal ki sabji","seasonal veg"}',null,60),

(3,'breakfast','Toasted bread','Toasted bread + milk + veg cutlet + jam + tomato sauce + seasonal fruit + tea','{}',null,60),
(3,'lunch','Kala chana','Rice + kala chana + salad + veg kofta + chapati','{}',null,60),
(3,'snacks','Noodles','Noodles + tea + tomato sauce','{}',null,60),
(3,'dinner','Matar paneer','Rice + matar paneer / kadahi paneer + egg curry + chapati + sooji halwa','{"matar paneer","kadahi paneer"}','egg curry',60),

(4,'breakfast','Pao bhaji','Pao bhaji / matar kulcha + tea + milk + seasonal fruit','{"pao bhaji","matar kulcha"}',null,60),
(4,'lunch','Rice + kadi pakoda','Rice + kadi pakoda / mix dal + zeera aloo + ring onion + chapati','{"kadi pakoda","mix dal"}',null,60),
(4,'snacks','Mix fritters','Mix fritters / veg burger + tea + tomato sauce','{"mix fritters","veg burger"}',null,60),
(4,'dinner','Lobhia dal','Rice + lobhia dal + aloo soyabean / lauki chana ki sabzi + roti + jalebi','{"aloo soyabean","lauki chana ki sabzi"}',null,60),

(5,'breakfast','Aloo kala chana','Aloo kala chana ki sabzi + daliya + ajwain ka paratha + tea + seasonal fruit','{}',null,60),
(5,'lunch','Rice + chole','Rice + chole + kaddu + raita + poori','{}',null,60),
(5,'snacks','Bread pakoda','Bread pakoda / aloo bonda + tea + sauce','{"bread pakoda","aloo bonda"}',null,60),
(5,'dinner','Manchurian with gravy','Manchurian with gravy + veg fried rice + aloo matar + chapati + kheer / sewaiyan','{"kheer","sewaiyan"}',null,60),

(6,'breakfast','Paneer paratha','Plain curd + paneer paratha + tea + pickle + seasonal fruit','{}',null,60),
(6,'lunch','Zeera rice','Zeera rice + dal makhni + aloo gobhi / seasonal veg + salad + chapati','{"aloo gobhi","seasonal veg"}',null,60),
(6,'snacks','Pasta','Pasta with tomato sauce + tea','{}',null,60),
(6,'dinner','Rice + arhar dal','Rice + arhar dal + aloo bhujia + aloo chokka + chapati / matar mushroom + custard','{"rice + arhar dal","matar mushroom"}',null,60),

(0,'breakfast','Chole + bhature','Chole + bhature + ring onion + tea + milk + seasonal fruit','{}',null,60),
(0,'lunch','Veg biryani','Veg biryani + aloo soyabean ki sabzi + papad + chapati + raita','{}',null,60),
(0,'snacks','Biscuit / namkeen / chips','Biscuit / namkeen / chips + tea','{"biscuit","namkeen","chips"}',null,60),
(0,'dinner','Chicken curry','Rice + chicken curry + kadhai paneer + chapati + ring onion + ice cream','{}','chicken curry',60)
on conflict do nothing;
